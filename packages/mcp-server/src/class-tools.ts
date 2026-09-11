/**
 * Creating a class, the way OMEdit creates one.
 *
 * `newModel` is the primitive underneath, and publishing it raw leaves the
 * caller holding a class that exists in OMC's symbol table and nowhere else:
 * no file, and no entry in the enclosing package's `package.order`, so it is
 * gone at the next restart. OMC's `save` does not close that gap either — it
 * writes to whatever path the symbol table already holds and never touches
 * `package.order`.
 *
 * The composition is a `loadString` that declares the class under a `within`
 * clause, then the source tree written out around it and OMC told where it
 * went. Only `loadString` can declare a restriction other than `model`, or a
 * top-level class at all.
 *
 * The gate is on `withinPath`, the package this writes into. A top-level class
 * names no package, and an empty name has no verdict to derive.
 */

import { linkPersistedClass, persistClass } from "@dicode/omc-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  errorResult,
  textResult,
  type McpToolClient,
  type McpToolDeps,
} from "./dispatch.js";
import { errorDetail } from "./error-detail.js";
import { refusalForClass } from "./write-gate.js";

const CLASS_KINDS = [
  "model",
  "package",
  "block",
  "connector",
  "function",
  "record",
  "type",
] as const;

const CreateClassSchema = z.object({
  name: z
    .string()
    .describe("Name of the new class on its own, not the dotted path."),
  kind: z
    .enum(CLASS_KINDS)
    .describe("Modelica restriction the class is declared with."),
  withinPath: z
    .string()
    .optional()
    .describe(
      "Fully qualified package to create the class inside; it must already be loaded. Omit for a top-level class.",
    ),
  extendsFrom: z
    .string()
    .optional()
    .describe("Fully qualified class the new one extends."),
});

export function registerClassTools(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "createClass",
    {
      description:
        "Create a Modelica class and write it to disk, adding it to the enclosing package's package.order. Use this rather than newModel, which leaves the class in OMC's memory with no file behind it.",
      inputSchema: CreateClassSchema,
      annotations: { readOnlyHint: false },
    },
    async ({ name, kind, withinPath, extendsFrom }) => {
      const client = await deps.ensureClient();
      if (withinPath !== undefined) {
        const refusal = await refusalForClass(
          deps.verdicts,
          client,
          withinPath,
          "createInside",
        );
        if (refusal !== undefined) return errorResult(refusal);
      }
      const className =
        withinPath === undefined ? name : `${withinPath}.${name}`;
      try {
        return await create(deps, client, {
          className,
          source: classSource(name, kind, withinPath, extendsFrom),
          leafKind: kind === "package" ? "package" : undefined,
        });
      } catch (err) {
        return errorResult(errorDetail(err));
      }
    },
  );
}

interface NewClass {
  readonly className: string;
  readonly source: string;
  readonly leafKind: "package" | undefined;
}

async function create(
  deps: McpToolDeps,
  client: McpToolClient,
  { className, source, leafKind }: NewClass,
): Promise<CallToolResult> {
  const { exists } = await client.existClass({ typeName: className });
  if (exists) {
    return errorResult(
      `${className} already exists — loading a new class over it would discard what is there.`,
    );
  }

  const { success } = await client.loadString({
    data: source,
    // The class has no file yet, and `loadString` binds it to whatever it is
    // given; a real path here would claim a file nothing has written.
    filename: `<runtime:${className}>`,
    merge: true,
  });
  if (!success) {
    const { errorString } = await client.getErrorString();
    return errorResult(
      errorString === "" ? `OMC refused to create ${className}` : errorString,
    );
  }

  const { workspace } = deps;
  if (workspace === undefined) {
    return textResult(
      JSON.stringify({
        className,
        fileName: null,
        warning: `${className} exists in OMC's memory only — this host has no source tree to write it to, so it will not survive a restart.`,
      }),
    );
  }
  try {
    const result = await persistClass(
      client,
      workspace,
      className,
      source,
      leafKind,
    );
    await linkPersistedClass(client, className, result);
    return textResult(JSON.stringify({ className, fileName: result.leafPath }));
  } catch (err) {
    return errorResult(await unloadAfterFailedWrite(client, className, err));
  }
}

/**
 * Take the declared class back out of OMC after its files could not be
 * written, and say what happened.
 *
 * Left in place it would be exactly what this tool exists to prevent — a class
 * in the symbol table and nowhere else — and the next attempt would be refused
 * for already existing. `deleteClass` unloads it without touching disk, so any
 * file that did land stays for the retry to overwrite.
 */
async function unloadAfterFailedWrite(
  client: McpToolClient,
  className: string,
  err: unknown,
): Promise<string> {
  const reason = `${className} could not be written to disk: ${errorDetail(err)}`;
  try {
    await client.deleteClass({ typeName: className });
  } catch (unloadErr) {
    return `${reason}. It is still loaded in OMC and unloading it failed too (${errorDetail(unloadErr)}), so creating it again will be refused until it is removed.`;
  }
  return `${reason}. It has been unloaded from OMC, so nothing was left half-created.`;
}

function classSource(
  name: string,
  kind: (typeof CLASS_KINDS)[number],
  withinPath: string | undefined,
  extendsFrom: string | undefined,
): string {
  const header = withinPath === undefined ? "" : `within ${withinPath};\n`;
  const base = extendsFrom === undefined ? "" : `  extends ${extendsFrom};\n`;
  return `${header}${kind} ${name}\n${base}end ${name};\n`;
}
