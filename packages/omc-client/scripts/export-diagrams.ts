/**
 * Exports the diagrams of every class extending `Modelica.Icons.Example`
 * under the given packages to a directory, for offline layout analysis.
 *
 *     pnpm --filter @dicode/omc-client export-diagrams -- --out <dir> Modelica
 *
 * Needs `omc` on PATH (or OMC_PATH). Output is a dataset, never a test fixture.
 */

import { main } from "../src/export/cli.js";

await main(process.argv.slice(2));
