/**
 * `systemLibrarySaveGuard` is what stops `modelica.savePackage` from
 * `setSourceFile`-ing a system-library class off MODELICAPATH, which would
 * strip origin-based read-only detection from its whole subtree.
 */

import { describe, expect, it, vi } from "vitest";

import type { SystemLibraryClient } from "../system-library.js";

import { systemLibrarySaveGuard } from "./package.js";

function makeClient(sourceFile: string): SystemLibraryClient {
  return {
    getSourceFile: vi.fn(() => Promise.resolve({ fileName: sourceFile })),
    getModelicaPath: vi.fn(() =>
      Promise.resolve({ modelicaPath: "/home/u/.openmodelica/libraries" }),
    ),
  };
}

describe("systemLibrarySaveGuard", () => {
  it("allows saving a workspace package", async () => {
    const client = makeClient("/ws/Pkg/package.mo");
    expect(await systemLibrarySaveGuard(client, "Pkg")).toBeUndefined();
  });

  it("refuses saving a system-library package", async () => {
    const client = makeClient(
      "/home/u/.openmodelica/libraries/Modelica 4.0.0/Blocks/package.mo",
    );

    const refusal = await systemLibrarySaveGuard(client, "Modelica.Blocks");

    expect(refusal).toContain("Modelica.Blocks");
    expect(refusal).toContain("read-only system library");
  });

  it("doesn't block the save when the origin lookup fails transiently", async () => {
    const client: SystemLibraryClient = {
      getSourceFile: vi.fn(() => Promise.reject(new Error("OMC busy"))),
      getModelicaPath: vi.fn(() =>
        Promise.resolve({ modelicaPath: "/home/u/.openmodelica/libraries" }),
      ),
    };

    // Matches systemLibraryCreateGuard's "failures don't block" contract.
    expect(await systemLibrarySaveGuard(client, "Pkg")).toBeUndefined();
  });
});
