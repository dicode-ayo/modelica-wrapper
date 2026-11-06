import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ModelInstance } from "../_shared/modelInstance.js";
import { exportDiagrams, type ExportClient } from "./diagram-dataset.js";

const instance = (
  name: string,
  extra: Partial<ModelInstance> = {},
): ModelInstance => ({ name, restriction: "model", elements: [], ...extra });

function client(overrides: Partial<ExportClient> = {}): ExportClient {
  return {
    getAllSubtypeOf: async () => ({ classNames: ["P.A", "P.B"] }),
    getModelInstance: async ({ typeName }) => ({
      instance: instance(typeName),
    }),
    getConnectionCount: async () => ({ count: 0 }),
    ...overrides,
  };
}

describe("exportDiagrams", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "export-diagrams-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the instance, layout and summary per class", async () => {
    await exportDiagrams(client(), { packages: ["P"], outDir: dir });
    expect((await readdir(dir)).sort()).toEqual([
      "P.A.diagram.json",
      "P.A.modelInstance.json",
      "P.B.diagram.json",
      "P.B.modelInstance.json",
      "summary.json",
    ]);
  });

  it("records a failing class and still exports the rest", async () => {
    const summary = await exportDiagrams(
      client({
        getModelInstance: async ({ typeName }) => {
          if (typeName === "P.A") throw new Error("boom");
          return { instance: instance(typeName) };
        },
      }),
      { packages: ["P"], outDir: dir },
    );
    expect(summary.failures).toEqual([{ className: "P.A", message: "boom" }]);
    expect(summary.classes.map((c) => c.className)).toEqual(["P.B"]);
    const written = JSON.parse(
      await readFile(join(dir, "summary.json"), "utf8"),
    );
    expect(written.failures).toHaveLength(1);
  });

  it("lists every connection-count mismatch", async () => {
    const dropped = {
      lhs: { $kind: "cref", parts: [] },
    } as unknown as NonNullable<ModelInstance["connections"]>[number];
    const summary = await exportDiagrams(
      client({
        getConnectionCount: async () => ({ count: 3 }),
        getModelInstance: async ({ typeName }) => ({
          instance: instance(typeName, { connections: [dropped] }),
        }),
      }),
      { packages: ["P"], outDir: dir },
    );
    expect(summary.connectionMismatches.map((c) => c.className)).toEqual([
      "P.A",
      "P.B",
    ]);
    expect(summary.connectionMismatches[0]).toMatchObject({
      instanceConnectionCount: 1,
      layoutConnectionCount: 0,
    });
  });

  it("queries only Example subclasses under each given package", async () => {
    const calls: unknown[] = [];
    await exportDiagrams(
      client({
        getAllSubtypeOf: async (input) => {
          calls.push(input);
          return { classNames: [] };
        },
      }),
      { packages: ["P", "Q"], outDir: dir },
    );
    expect(calls).toEqual([
      { typeName: "Modelica.Icons.Example", parentClass: "P" },
      { typeName: "Modelica.Icons.Example", parentClass: "Q" },
    ]);
  });

  it("records a failing package lookup and continues with the others", async () => {
    const summary = await exportDiagrams(
      client({
        getAllSubtypeOf: async ({ parentClass }) => {
          if (parentClass === "P") throw new Error("no such package");
          return { classNames: ["Q.X"] };
        },
      }),
      { packages: ["P", "Q"], outDir: dir },
    );
    expect(summary.failures[0]?.className).toBe("P");
    expect(summary.classes.map((c) => c.className)).toEqual(["Q.X"]);
  });

  it("qualifies names relative to the package and drops the base class", async () => {
    const summary = await exportDiagrams(
      client({
        getAllSubtypeOf: async () => ({
          classNames: ["Icons.Example", "Electrical.A", "Modelica.Blocks.B"],
        }),
      }),
      { packages: ["Modelica"], outDir: dir },
    );
    expect(summary.classes.map((c) => c.className)).toEqual([
      "Modelica.Blocks.B",
      "Modelica.Electrical.A",
    ]);
  });

  it("exports a class once when packages overlap, in sorted order", async () => {
    const summary = await exportDiagrams(
      client({
        getAllSubtypeOf: async () => ({ classNames: ["P.B", "P.A"] }),
      }),
      { packages: ["P", "P"], outDir: dir },
    );
    expect(summary.classes.map((c) => c.className)).toEqual(["P.A", "P.B"]);
  });

  it("keeps a hostile class name inside the output directory", async () => {
    const summary = await exportDiagrams(
      client({
        getAllSubtypeOf: async () => ({ classNames: ["P.'../../evil'"] }),
      }),
      { packages: ["P"], outDir: dir },
    );
    expect(summary.failures).toEqual([]);
    const files = await readdir(dir);
    expect(files.every((f) => !f.includes("/"))).toBe(true);
    expect(files).toContain("P._.._.._evil_.diagram.json");
  });

  it("records a file-name collision instead of overwriting", async () => {
    const summary = await exportDiagrams(
      client({
        getAllSubtypeOf: async () => ({ classNames: ["P.'a b'", "P.'a/b'"] }),
      }),
      { packages: ["P"], outDir: dir },
    );
    expect(summary.classes).toHaveLength(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]?.message).toContain("collides");
  });

  it("compares the layout against connections inherited through extends, not OMC's own-class count", async () => {
    const conn = { lhs: { $kind: "cref", parts: [] } };
    const base = instance("Base", {
      connections: [conn, conn] as unknown as ModelInstance["connections"],
    });
    const summary = await exportDiagrams(
      client({
        getModelInstance: async ({ typeName }) => ({
          instance: instance(typeName, {
            elements: [
              { $kind: "extends", baseClass: base },
            ] as unknown as ModelInstance["elements"],
          }),
        }),
      }),
      { packages: ["P"], outDir: dir },
    );
    expect(summary.classes[0]).toMatchObject({
      omcConnectionCount: 0,
      instanceConnectionCount: 2,
    });
    expect(summary.connectionMismatches).toHaveLength(2);
  });
});
