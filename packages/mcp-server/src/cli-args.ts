import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { errorDetail } from "./error-detail.js";

export type CliArgs =
  | { readonly kind: "help" }
  | { readonly kind: "serve"; readonly root: string }
  | { readonly kind: "invalid"; readonly message: string };

export const USAGE = `Usage: modelica-mcp [--root <dir>]

Serves the Modelica (OpenModelica) MCP tool set over stdio.

  --root <dir>  Source tree createClass writes into, and under which OMC's
                working directory is parked (<dir>/.modelica).
                Defaults to the current directory.
  -h, --help    Print this message.

Spawns its own omc from PATH on the first tool call; classes an editor
window has loaded are not visible to it.
`;

export function parseCliArgs(argv: readonly string[], cwd: string): CliArgs {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        help: { type: "boolean", short: "h" },
        root: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    });
    if (values.help === true) return { kind: "help" };
    return { kind: "serve", root: resolve(cwd, values.root ?? ".") };
  } catch (err) {
    return { kind: "invalid", message: errorDetail(err) };
  }
}
