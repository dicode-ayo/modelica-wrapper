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
 * The composition is {@link declareClass} followed by {@link persistClass},
 * the same pair the editor's own New Class command runs.
 *
 * The gate is on `withinPath`, the package this writes into. A top-level class
 * names no package, and an empty name has no verdict to derive.
 *
 * A tree whose own root is a package has no top-level destination: a class
 * written beside its `package.mo` with no `within` clause makes OMC refuse the
 * whole package. {@link enclosingPackage} resolves that root as the parent
 * instead, and refuses when it cannot name exactly one loaded class.
 */

import * as path from "node:path";

import {
  CLASS_KINDS,
  declareClass,
  linkPersistedClass,
  pathExists,
  persistClass,
  qualifiedNameOf,
  resolveRootPackageParent,
  type ClassDeclaration,
  type SourceTree,
} from "@dicode/omc-client";
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
      try {
        const parent =
          withinPath ?? (await enclosingPackage(client, deps.workspace));
        if (typeof parent === "object") return errorResult(parent.reason);
        if (parent !== undefined) {
          const refusal = await refusalForClass(
            deps.verdicts,
            client,
            parent,
            "createInside",
          );
          if (refusal !== undefined) return errorResult(refusal);
        }
        return await declareAndPersist(deps, client, {
          name,
          kind,
          withinPath: parent,
          extendsFrom,
        });
      } catch (err) {
        return errorResult(errorDetail(err));
      }
    },
  );
}

async function declareAndPersist(
  deps: McpToolDeps,
  client: McpToolClient,
  declaration: ClassDeclaration,
): Promise<CallToolResult> {
  const className = qualifiedNameOf(declaration);
  const { exists } = await client.existClass({ typeName: className });
  if (exists) {
    return errorResult(
      `${className} already exists — loading a new class over it would discard what is there.`,
    );
  }

  const declared = await declareClass(client, declaration);
  if (!declared.ok) return errorResult(declared.reason);

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
      declared.source,
      declaration.kind,
    );
    await linkPersistedClass(client, className, result);
    const warning = inlineParentWarning(declaration, result.enclosingPackage);
    return textResult(
      JSON.stringify({
        className,
        fileName: result.leafPath,
        ...(warning === undefined ? {} : { warning }),
      }),
    );
  } catch (err) {
    return errorResult(await unloadAfterFailedWrite(client, className, err));
  }
}

/**
 * What to tell a caller whose new class went beside a package stored as one
 * file rather than inside a directory package.
 *
 * The class is loaded and the file is written, but no `package.order` names
 * it, so anything that loads the parent on its own — another client, a fresh
 * checkout, OMEdit — will not see it. The editor that hosts this server loads
 * every top-level file in the tree, so there it comes back.
 */
function inlineParentWarning(
  declaration: ClassDeclaration,
  enclosingPackage: "directory" | "file" | undefined,
): string | undefined {
  if (enclosingPackage !== "file") return undefined;
  const parent = declaration.withinPath ?? "its parent";
  return `${parent} is stored as a single file rather than a directory package, so nothing beside the new file lists it — loading ${parent} on its own will not bring it in. Use setSourceCode on ${parent} to declare the class inside that file instead.`;
}

/**
 * The package a class with no `withinPath` has to be created inside: the one
 * the tree's own root `package.mo` declares, or nothing when the root is not a
 * package and a top-level class is a real destination.
 */
async function enclosingPackage(
  client: McpToolClient,
  workspace: SourceTree | undefined,
): Promise<string | undefined | { reason: string }> {
  if (workspace === undefined) return undefined;
  const rootPkg = path.join(workspace.root, "package.mo");
  if (!(await pathExists(rootPkg))) return undefined;
  const resolved = await resolveRootPackageParent(client, rootPkg);
  return resolved.ok
    ? resolved.parent
    : {
        reason: `this source tree's root is a package, so a class cannot be created outside it — ${resolved.reason}. Name the package to create it inside with withinPath.`,
      };
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
