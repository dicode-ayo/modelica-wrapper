/**
 * Writing a class OMC holds in memory back to the source tree.
 *
 * `createClass` is the only tool that writes anything on its own. Everything
 * done to a class afterwards — a component added, a connection drawn, a
 * parameter set, a whole source replaced — changes OMC's symbol table and
 * stops there. In the editor the user saves the buffer and the source provider
 * persists it; an assistant driving these tools has no equivalent, so a model
 * it builds and simulates successfully can still be a three-line stub on disk.
 *
 * This is that equivalent. {@link saveClass} is the same persistence
 * `createClass` composes, so the two agree on where bytes go and on what
 * `package.order` should say.
 *
 * OMC's own `save`, reachable through `omc_invoke`, is not this: it writes to
 * whatever path the symbol table already holds — a `<runtime:…>` placeholder
 * for a class created here — leaves `package.order` alone, and on a package
 * writes the `package.mo` without its children.
 */

import { saveClass } from "@dicode/omc-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { errorResult, textResult, type McpToolDeps } from "./dispatch.js";
import { errorDetail } from "./error-detail.js";
import { refusalForClass } from "./write-gate.js";

const SaveClassSchema = z.strictObject({
  className: z
    .string()
    .min(1)
    .describe("Fully qualified class to write to disk."),
});

export function registerSaveTools(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "saveClass",
    {
      description:
        "Write a class to its source file, creating one under the workspace when it has none and keeping the enclosing package's package.order current. Edits from the other mutating tools change OMC's memory only — call this to persist them. On a package it saves the members too.",
      inputSchema: SaveClassSchema,
      annotations: { readOnlyHint: false },
    },
    async ({ className }) => {
      const client = await deps.ensureClient();
      try {
        const { exists } = await client.existClass({ typeName: className });
        if (!exists) {
          return errorResult(
            `no class named ${className} is loaded, so there is nothing to save.`,
          );
        }

        const refusal = await refusalForClass(
          deps.verdicts,
          client,
          className,
          "save",
        );
        if (refusal !== undefined) return errorResult(refusal);

        const { workspace } = deps;
        if (workspace === undefined) {
          return errorResult(
            `${className} cannot be saved — this host has no source tree to write to, so its edits stay in OMC's memory and will not survive a restart.`,
          );
        }

        const { saved, skipped, warnings } = await saveClass(
          client,
          workspace,
          className,
          {
            // Every member a package reaches is a write of its own, and the
            // verdict above judged only the class the caller named.
            authorize: (member) =>
              refusalForClass(deps.verdicts, client, member, "save"),
          },
        );
        return textResult(
          JSON.stringify({
            className,
            saved,
            ...(skipped.length === 0 ? {} : { skipped }),
            ...(warnings.length === 0 ? {} : { warnings }),
          }),
        );
      } catch (err) {
        return errorResult(
          `${className} could not be written to disk: ${errorDetail(err)}`,
        );
      }
    },
  );
}
