/**
 * Network-dependent integration tests for the Library / package-management
 * category — exercises every wrapper that talks to OMC's external package
 * index (https://libraries.openmodelica.org).
 *
 * Wrappers covered here:
 *
 *   - getAvailableLibraries
 *   - getAvailableLibraryVersions
 *   - getAvailablePackageVersions
 *   - getAvailablePackageConversionsFrom
 *   - getAvailablePackageConversionsTo
 *   - getConversionsFromVersions
 *   - installPackage
 *   - updatePackageIndex
 *   - upgradeInstalledPackages
 *
 * Gating: this suite runs ONLY when `OMC_INTEGRATION_NETWORK=1`, in
 * addition to the standard `omc`-on-PATH check used by the rest of the
 * integration suite. CI keeps the gate off by default — the package-index
 * endpoint isn't always reachable from runners, and a flake there would
 * be unrelated to the wrappers' behaviour. To run locally:
 *
 *   OMC_INTEGRATION_NETWORK=1 pnpm --filter @modelica-wrapper/omc-client \
 *     vitest run test/library-network.integration.test.ts
 *
 * Side effects: `updatePackageIndex` mutates OMC's local package-index
 * cache (`~/.openmodelica/libraries/index.json` or similar). `installPackage`
 * writes the library under `~/.openmodelica/libraries/`. The suite does
 * NOT uninstall what it installs; runs are expected to be infrequent and
 * the artifacts are tiny + reusable across runs.
 */

import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";

const NETWORK_FLAG = "OMC_INTEGRATION_NETWORK";

function shouldRun(): boolean {
  if (process.env[NETWORK_FLAG] !== "1") return false;
  if (process.env.OMC_INTEGRATION === "0") return false;
  if (process.env.OMC_PATH && process.env.OMC_PATH.length > 0) return true;
  try {
    execSync(process.platform === "win32" ? "where omc" : "command -v omc", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const describeIf = shouldRun() ? describe : describe.skip;

describeIf("OmcClient library/network calls against the real package index", () => {
  let client: OmcClient;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    // Network calls can be sluggish on the OMC side.
    client.setCallTimeout(120_000);
  });

  afterEach(async () => {
    await client.close();
  });

  it("updatePackageIndex refreshes the local index", async () => {
    const { result } = await client.updatePackageIndex();
    expect(result).toBe(true);
  });

  it("getAvailableLibraries returns Modelica among the known libraries", async () => {
    const { libraries } = await client.getAvailableLibraries();
    expect(libraries.length).toBeGreaterThan(0);
    expect(libraries).toContain("Modelica");
  });

  it("getAvailableLibraryVersions returns versions for Modelica", async () => {
    const { librariesAndVersions } =
      await client.getAvailableLibraryVersions({ typeName: "Modelica" });
    expect(librariesAndVersions.length).toBeGreaterThan(0);
    // Each entry should mention Modelica somewhere — exact format is
    // "<name> <version>".
    expect(
      librariesAndVersions.every((s) => /modelica/i.test(s)),
    ).toBe(true);
  });

  it("getAvailablePackageVersions accepts an open constraint", async () => {
    // Empty version-constraint string returns every cached version.
    const { withoutConversion } = await client.getAvailablePackageVersions({
      typeName: "Modelica",
      version: "",
    });
    expect(Array.isArray(withoutConversion)).toBe(true);
  });

  it("getConversionsFromVersions returns the two-array partition shape", async () => {
    const { withoutConversion, withConversion } =
      await client.getConversionsFromVersions({ typeName: "Modelica" });
    expect(Array.isArray(withoutConversion)).toBe(true);
    expect(Array.isArray(withConversion)).toBe(true);
  });

  it("getAvailablePackageConversionsFrom returns an array", async () => {
    const { convertsTo } = await client.getAvailablePackageConversionsFrom({
      typeName: "Modelica",
      version: "3.2.3",
    });
    expect(Array.isArray(convertsTo)).toBe(true);
  });

  it("getAvailablePackageConversionsTo returns an array", async () => {
    const { convertsTo } = await client.getAvailablePackageConversionsTo({
      typeName: "Modelica",
      version: "4.0.0",
    });
    expect(Array.isArray(convertsTo)).toBe(true);
  });

  it("installPackage(Modelica, '', false) reports success", async () => {
    // Without a version OMC picks its default; this is the same call shape
    // the project's CI .mos script uses to seed Modelica into a -minimal image.
    const { result } = await client.installPackage({
      typeName: "Modelica",
      version: "",
      exactMatch: false,
    });
    expect(result).toBe(true);
  });

  it("upgradeInstalledPackages reports success", async () => {
    const { result } = await client.upgradeInstalledPackages({
      installNewestVersions: false,
    });
    expect(result).toBe(true);
  });
});
