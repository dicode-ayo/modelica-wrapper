import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ModelInstance } from "../_shared/modelInstance.js";
import { exportDiagrams, type ExportClient } from "./diagram-dataset.js";

const instance = (name: string): ModelInstance =>
  ({ name, elements: [], $kind: "class" }) as unknown as ModelInstance;

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
    const summary = await exportDiagrams(
      client({ getConnectionCount: async () => ({ count: 3 }) }),
      { packages: ["P"], outDir: dir },
    );
    expect(summary.connectionMismatches.map((c) => c.className)).toEqual([
      "P.A",
      "P.B",
    ]);
    expect(summary.connectionMismatches[0]).toMatchObject({
      omcConnectionCount: 3,
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
});
