/**
 * Writes the hand-drawn diagrams of every `Modelica.Icons.Example` subclass
 * as an offline dataset: OMC's raw instance tree, the produced layout, and a
 * summary that makes dropped connections and failed classes visible.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, isAbsolute } from "node:path";

import { walkExtendsChain } from "../_shared/extendsChain.js";
import { produceDiagramLayout } from "../api/diagram/producer.js";
import type { ModelInstance } from "../_shared/modelInstance.js";

export const EXAMPLE_BASE_CLASS = "Modelica.Icons.Example";

export interface ExportClient {
  getAllSubtypeOf(input: {
    typeName: string;
    parentClass: string;
  }): Promise<{ classNames: string[] }>;
  getModelInstance(input: {
    typeName: string;
  }): Promise<{ instance: ModelInstance }>;
  getConnectionCount(input: { typeName: string }): Promise<{ count: number }>;
}

export interface ClassSummary {
  className: string;
  componentCount: number;
  /** OMC's count covers only the class's own `connect` equations. */
  omcConnectionCount: number;
  /** `connections` declared across the class and everything it extends. */
  instanceConnectionCount: number;
  layoutConnectionCount: number;
}

export interface ExportFailure {
  className: string;
  message: string;
}

export interface ExportSummary {
  packages: string[];
  classes: ClassSummary[];
  failures: ExportFailure[];
  /** Classes whose layout kept a different number of connections than the instance declares. */
  connectionMismatches: ClassSummary[];
}

export interface ExportOptions {
  packages: string[];
  outDir: string;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Class names are OMC-supplied and may be quoted identifiers holding path characters. */
function fileStem(className: string): string {
  const stem = className.replace(/[^A-Za-z0-9._-]/g, "_");
  return /^\.+$/.test(stem) ? "_" : stem;
}

function insideDir(dir: string, path: string): boolean {
  const rel = relative(resolve(dir), resolve(path));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** getAllSubtypeOf answers relative to `parentClass` and includes the base class. */
function qualify(pkg: string, name: string): string {
  return name === pkg || name.startsWith(`${pkg}.`) ? name : `${pkg}.${name}`;
}

function instanceConnectionCount(instance: ModelInstance): number {
  let n = 0;
  for (const { klass } of walkExtendsChain(instance)) {
    n += klass.connections?.length ?? 0;
  }
  return n;
}

async function exportClass(
  client: ExportClient,
  className: string,
  outDir: string,
  claimed: Map<string, string>,
): Promise<ClassSummary> {
  const stem = fileStem(className);
  const owner = claimed.get(stem);
  if (owner !== undefined) {
    throw new Error(`file name collides with ${owner}`);
  }
  const instancePath = join(outDir, `${stem}.modelInstance.json`);
  const diagramPath = join(outDir, `${stem}.diagram.json`);
  if (!insideDir(outDir, instancePath) || !insideDir(outDir, diagramPath)) {
    throw new Error("file name escapes the output directory");
  }
  claimed.set(stem, className);
  const { instance } = await client.getModelInstance({ typeName: className });
  const { count } = await client.getConnectionCount({ typeName: className });
  const layout = produceDiagramLayout(instance, "diagram");
  await writeJson(instancePath, instance);
  await writeJson(diagramPath, layout);
  return {
    className,
    componentCount: Object.keys(layout.components).length,
    omcConnectionCount: count,
    instanceConnectionCount: instanceConnectionCount(instance),
    layoutConnectionCount: layout.connections.length,
  };
}

/** One failing class is recorded and skipped; it never aborts the run. */
export async function exportDiagrams(
  client: ExportClient,
  options: ExportOptions,
): Promise<ExportSummary> {
  await mkdir(options.outDir, { recursive: true });
  const summary: ExportSummary = {
    packages: options.packages,
    classes: [],
    failures: [],
    connectionMismatches: [],
  };

  const classNames = new Set<string>();
  for (const pkg of options.packages) {
    try {
      const { classNames: found } = await client.getAllSubtypeOf({
        typeName: EXAMPLE_BASE_CLASS,
        parentClass: pkg,
      });
      for (const name of found) {
        const qualified = qualify(pkg, name);
        if (qualified !== EXAMPLE_BASE_CLASS) classNames.add(qualified);
      }
    } catch (err) {
      summary.failures.push({ className: pkg, message: messageOf(err) });
    }
  }

  const claimed = new Map<string, string>();
  for (const className of [...classNames].sort()) {
    try {
      const entry = await exportClass(
        client,
        className,
        options.outDir,
        claimed,
      );
      summary.classes.push(entry);
      if (entry.instanceConnectionCount !== entry.layoutConnectionCount) {
        summary.connectionMismatches.push(entry);
      }
    } catch (err) {
      summary.failures.push({ className, message: messageOf(err) });
    }
  }

  await writeJson(join(options.outDir, "summary.json"), summary);
  return summary;
}
