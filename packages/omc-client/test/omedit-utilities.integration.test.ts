/**
 * Live integration tests for the OMEdit-utility wrappers wired in #63/#64/#65:
 *   - getDerivedUnits (unit-dropdown partner to convertUnits)
 *   - uriToFilename   (resolve modelica:// resource URIs)
 *   - qualifyPath     (resolve a short type name to its fully qualified path)
 *   - loadClassContentString (insert string content into a loaded class)
 *
 * All four were probed against OMC 1.26.7 (Modelica loaded) and confirmed
 * to work with the quoted-String / bare-TypeName call shapes used here.
 *
 * Auto-skips when `omc` isn't on PATH.
 */

import { execSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";

function shouldRun(): boolean {
  const flag = process.env.OMC_INTEGRATION;
  if (flag === "0") return false;
  if (flag === "1") return true;
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

describeIf("OMEdit utilities (live OMC)", () => {
  let client: OmcClient;

  beforeAll(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    await client.loadModel({ typeName: "Modelica" });
  }, 120_000);

  afterAll(async () => {
    await client.close();
  });

  describe("getDerivedUnits", () => {
    it('returns a non-empty list for the base unit "K"', async () => {
      const { derivedUnits } = await client.getDerivedUnits({ baseUnit: "K" });
      expect(Array.isArray(derivedUnits)).toBe(true);
      expect(derivedUnits.length).toBeGreaterThan(0);
      // Probed on 1.26.7: {"degC", "degF", "degRk"}.
      expect(derivedUnits).toContain("degC");
    });

    it("returns an empty list for a base unit with no derived units", async () => {
      const { derivedUnits } = await client.getDerivedUnits({ baseUnit: "1" });
      expect(derivedUnits).toEqual([]);
    });
  });

  describe("uriToFilename", () => {
    it("resolves a modelica:// resource URI to an absolute path", async () => {
      const { filename } = await client.uriToFilename({
        uri: "modelica://Modelica/package.mo",
      });
      expect(filename).not.toBe("");
      expect(filename.endsWith("package.mo")).toBe(true);
      // Resolves into the loaded Modelica library directory.
      expect(filename).toContain("Modelica");
    });

    it("returns an empty string for an unresolvable URI", async () => {
      const { filename } = await client.uriToFilename({
        uri: "modelica://NoSuchLibrary/x.png",
      });
      expect(filename).toBe("");
    });
  });

  describe("qualifyPath", () => {
    it("qualifies a short type name within a class scope", async () => {
      const { qualifiedPath } = await client.qualifyPath({
        typeName: "Modelica.Electrical.Analog.Basic",
        path: "Resistor",
      });
      expect(qualifiedPath).toBe("Modelica.Electrical.Analog.Basic.Resistor");
    });
  });

  describe("loadClassContentString", () => {
    it("inserts string content into a loaded class", async () => {
      const ok = await client.loadString({
        data: "model PasteTargetIT Real x; end PasteTargetIT;",
      });
      expect(ok.success).toBe(true);

      const { success } = await client.loadClassContentString({
        data: "Real y;",
        typeName: "PasteTargetIT",
      });
      expect(success).toBe(true);

      const { contents } = await client.listFile({ typeName: "PasteTargetIT" });
      expect(contents).toContain("Real y;");
    });

    it("offsets inserted Placement annotations", async () => {
      const ok = await client.loadString({
        data: "model PasteOffsetIT Real x; end PasteOffsetIT;",
      });
      expect(ok.success).toBe(true);

      const { success } = await client.loadClassContentString({
        data: "Modelica.Blocks.Math.Gain g annotation(Placement(transformation(extent={{0,0},{20,20}})));",
        typeName: "PasteOffsetIT",
        offsetX: 50,
        offsetY: 50,
      });
      expect(success).toBe(true);

      const { contents } = await client.listFile({ typeName: "PasteOffsetIT" });
      expect(contents).toContain("origin = {50, 50}");
    });
  });
});
