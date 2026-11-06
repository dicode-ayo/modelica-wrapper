/**
 * Writes the hand-drawn diagrams of every `Modelica.Icons.Example` subclass
 * as an offline dataset: OMC's raw instance tree, the produced layout, and a
 * summary that makes dropped connections and failed classes visible.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  omcConnectionCount: number;
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
  /** Classes where OMC counts more connections than the layout kept. */
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

async function exportClass(
  client: ExportClient,
  className: string,
  outDir: string,
): Promise<ClassSummary> {
  const { instance } = await client.getModelInstance({ typeName: className });
  const { count } = await client.getConnectionCount({ typeName: className });
  const layout = produceDiagramLayout(instance, "diagram");
  await writeJson(join(outDir, `${className}.modelInstance.json`), instance);
  await writeJson(join(outDir, `${className}.diagram.json`), layout);
  return {
    className,
    componentCount: Object.keys(layout.components).length,
    omcConnectionCount: count,
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
      for (const name of found) classNames.add(name);
    } catch (err) {
      summary.failures.push({ className: pkg, message: messageOf(err) });
    }
  }

  for (const className of [...classNames].sort()) {
    try {
      const entry = await exportClass(client, className, options.outDir);
      summary.classes.push(entry);
      if (entry.omcConnectionCount !== entry.layoutConnectionCount) {
        summary.connectionMismatches.push(entry);
      }
    } catch (err) {
      summary.failures.push({ className, message: messageOf(err) });
    }
  }

  await writeJson(join(options.outDir, "summary.json"), summary);
  return summary;
}
