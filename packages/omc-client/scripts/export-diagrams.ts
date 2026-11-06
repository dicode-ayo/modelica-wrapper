/**
 * Exports the diagrams of every class extending `Modelica.Icons.Example`
 * under the given packages to a directory, for offline layout analysis.
 *
 *     pnpm --filter @dicode/omc-client export-diagrams -- --out <dir> Modelica
 *
 * Needs `omc` on PATH (or OMC_PATH). Output is a dataset, never a test fixture.
 */

import { OmcClient } from "../src/client.js";
import { exportDiagrams } from "../src/export/diagram-dataset.js";

function parseArgs(argv: string[]): { out: string; packages: string[] } {
  const packages: string[] = [];
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || arg === "--") continue;
    if (arg === "--out") {
      out = argv[++i];
    } else {
      packages.push(arg);
    }
  }
  if (out === undefined || packages.length === 0) {
    console.error("usage: export-diagrams --out <dir> <Package>...");
    process.exit(2);
  }
  return { out, packages };
}

const { out, packages } = parseArgs(process.argv.slice(2));
const client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
try {
  const summary = await exportDiagrams(client, { packages, outDir: out });
  console.log(
    `exported ${summary.classes.length} classes, ${summary.failures.length} failures, ${summary.connectionMismatches.length} connection mismatches -> ${out}`,
  );
  if (summary.failures.length > 0) process.exitCode = 1;
} finally {
  await client.close();
}
