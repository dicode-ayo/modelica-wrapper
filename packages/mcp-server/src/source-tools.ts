/**
 * Replacing a class's source, the way OMEdit's `setSourceCode` does.
 *
 * `loadString` is the wrapper underneath, and it is the file binding rather
 * than the class name that this tool adds: the current source path is resolved
 * first because `loadString` binds the class to whatever `filename` it is
 * given, and the default evicts the class from the file it was stored in. A
 * class OMC cannot place — one being created here for the first time — has no
 * path to preserve.
 *
 * Two things are gated, because two are at stake: whatever `code` declares,
 * which the gate derives from its `within` clause, and `className`, whose file
 * the reload takes over whatever the code says.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  dispatchByName,
  type McpToolClient,
  type McpToolDeps,
} from "./dispatch.js";
import { registerTool } from "./register-tool.js";

const SetSourceCodeSchema = z.strictObject({
  className: z
    .string()
    .describe("Class whose source is replaced, fully qualified."),
  code: z
    .string()
    .describe(
      "Complete Modelica source for the class, including its `within` clause when it is nested.",
    ),
});

/** OMC's placeholders for a class with no file behind it. */
function diskPath(fileName: string): string | undefined {
  return fileName === "" || fileName.startsWith("<") ? undefined : fileName;
}

async function currentSourceFile(
  client: McpToolClient,
  className: string,
): Promise<string | undefined> {
  try {
    const { fileName } = await client.getSourceFile({ typeName: className });
    return diskPath(fileName);
  } catch {
    return undefined;
  }
}

/** Tool names this module registers, for the discovery tools' own index. */
export function registerSourceTools(
  server: McpServer,
  deps: McpToolDeps,
): readonly string[] {
  const TOOL_NAME = "setSourceCode";
  registerTool(
    server,
    TOOL_NAME,
    {
      description:
        "Replace a class's Modelica source and reload it into OMC, keeping it bound to the file it came from. The file itself is not written — call saveClass to persist the change.",
      inputSchema: SetSourceCodeSchema,
      annotations: { readOnlyHint: false },
    },
    async ({ className, code }) => {
      const client = await deps.ensureClient();
      const filename = await currentSourceFile(client, className);
      return dispatchByName(
        deps,
        "loadString",
        filename === undefined ? { data: code } : { data: code, filename },
        { className, action: "edit" },
      );
    },
  );
  return [TOOL_NAME];
}
