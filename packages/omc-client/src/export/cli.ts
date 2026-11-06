import { parseArgs } from "node:util";

import { OmcClient } from "../client.js";
import { exportDiagrams } from "./diagram-dataset.js";

export const USAGE = "usage: export-diagrams --out <dir> <Package>...";

/** pnpm forwards a literal `--` before the script's own flags; parseArgs would read everything after it as positional. */
export function parseCliArgs(argv: string[]): {
  out: string;
  packages: string[];
} {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const { values, positionals } = parseArgs({
    args,
    options: { out: { type: "string" } },
    allowPositionals: true,
    strict: true,
  });
  if (values.out === undefined || positionals.length === 0) {
    throw new Error(USAGE);
  }
  return { out: values.out, packages: positionals };
}

export async function main(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
    return;
  }
  const omcPath = process.env.OMC_PATH;
  const client = await OmcClient.create(omcPath ? { omcPath } : {});
  try {
    const summary = await exportDiagrams(client, {
      packages: parsed.packages,
      outDir: parsed.out,
    });
    console.log(
      `exported ${summary.classes.length} classes, ${summary.failures.length} failures, ${summary.connectionMismatches.length} connection mismatches -> ${parsed.out}`,
    );
    if (summary.failures.length > 0) process.exitCode = 1;
  } finally {
    await client.close();
  }
}
