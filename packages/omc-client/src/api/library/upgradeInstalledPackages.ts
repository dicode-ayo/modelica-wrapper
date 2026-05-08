/**
 * OMC: `function upgradeInstalledPackages`
 *
 * Upgrades installed packages. With `installNewestVersions=true` (the default), installs the newest available version of each package.
 *
 * ```modelica
 * function upgradeInstalledPackages
 *   input Boolean installNewestVersions = true;
 *   output Boolean result;
 * end upgradeInstalledPackages;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const UpgradeInstalledPackagesInputSchema = z.object({
  installNewestVersions: z.boolean().optional().default(true).describe("Install the newest available version of each package when true."),
});
export type UpgradeInstalledPackagesInput = z.input<
  typeof UpgradeInstalledPackagesInputSchema
>;

export const UpgradeInstalledPackagesOutputSchema = z.object({
  result: z.boolean().describe("True if the upgrade completed; field name `result` is OMC verbatim."),
});
export type UpgradeInstalledPackagesOutput = z.infer<
  typeof UpgradeInstalledPackagesOutputSchema
>;

export const UpgradeInstalledPackagesDescription =
  "Upgrade installed packages. With `installNewestVersions=true` (the default), installs the newest available version of each package.";

export async function upgradeInstalledPackages(
  ctx: CallContext,
  input: UpgradeInstalledPackagesInput = {},
): Promise<UpgradeInstalledPackagesOutput> {
  const installNewestVersions = input.installNewestVersions ?? true;
  const raw = await ctx.call(
    `upgradeInstalledPackages(${mlBool(installNewestVersions)})`,
  );
  return parseOutput(
    UpgradeInstalledPackagesOutputSchema,
    { result: expectBool(parse(raw)) },
    "upgradeInstalledPackages",
  );
}
