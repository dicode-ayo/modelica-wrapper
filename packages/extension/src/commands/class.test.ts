/**
 * `systemLibraryCreateGuard` is what stops `modelica.createClass` from
 * extracting a new file directly into an installed MODELICAPATH library when
 * invoked on a system-library parent node (see #348).
 */

import { describe, expect, it, vi } from "vitest";

import type { SystemLibraryClient } from "../system-library.js";

import { systemLibraryCreateGuard } from "./class.js";

function makeClient(sourceFile: string): SystemLibraryClient {
  return {
    getSourceFile: vi.fn(() => Promise.resolve({ fileName: sourceFile })),
    getModelicaPath: vi.fn(() =>
      Promise.resolve({ modelicaPath: "/home/u/.openmodelica/libraries" }),
    ),
  };
}

describe("systemLibraryCreateGuard", () => {
  it("allows a top-level class (no parent)", async () => {
    const client = makeClient(
      "/home/u/.openmodelica/libraries/Modelica/package.mo",
    );
    expect(await systemLibraryCreateGuard(client, undefined)).toBeUndefined();
  });

  it("allows creating inside a workspace package", async () => {
    const client = makeClient("/ws/Pkg/package.mo");
    expect(await systemLibraryCreateGuard(client, "Pkg")).toBeUndefined();
  });

  it("refuses creating inside a system-library package", async () => {
    const client = makeClient(
      "/home/u/.openmodelica/libraries/Modelica 4.0.0/Blocks/package.mo",
    );

    const refusal = await systemLibraryCreateGuard(client, "Modelica.Blocks");

    expect(refusal).toContain("Modelica.Blocks");
    expect(refusal).toContain("read-only system library");
  });
});
