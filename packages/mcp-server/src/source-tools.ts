/**
 * Replacing a class's source, the way OMEdit's `setSourceCode` does.
 *
 * `loadString` is the wrapper underneath, and publishing it raw would leave the
 * write gate with nothing to judge: its arguments carry source text and a file
 * path, never a class name, so an assistant could redefine
 * `Modelica.Electrical.Analog.Basic.Resistor` unrefused. Naming the class in
 * the tool is what lets the verdict be derived, and it is the shape OMEdit
 * publishes anyway.
 *
 * The current source path is resolved first because `loadString` binds the
 * class to whatever `filename` it is given, and the default evicts the class
 * from the file it was stored in. A class OMC cannot place — one being created
 * here for the first time — has no path to preserve.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  dispatchByName,
  type McpToolClient,
  type McpToolDeps,
} from "./dispatch.js";

const SetSourceCodeSchema = z.object({
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

export function registerSourceTools(
  server: McpServer,
  deps: McpToolDeps,
): void {
  server.registerTool(
    "setSourceCode",
    {
      description:
        "Replace a class's Modelica source and reload it into OMC, keeping it bound to the file it came from.",
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
}
