/**
 * `modelica.savePackage` must refuse a system-library class before it prompts
 * for a target: its `setSourceFile` would repoint the class off MODELICAPATH,
 * stripping origin-based read-only detection from the whole subtree.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { describe, expect, it, vi } from "vitest";

import type { OmcClient } from "@dicode/omc-client";

import { runCommand } from "../../test-support/vscode-mock.js";
import { WriteVerdicts } from "../write-verdict.js";

import type { CommandContext, LibraryNode } from "./context.js";
import { registerPackageCommands } from "./package.js";

const MODELICA_PATH = "/home/u/.openmodelica/libraries";

const NODE: LibraryNode = {
  qualifiedName: "Modelica.Blocks",
  displayName: "Blocks",
  restriction: "package",
};

describe("modelica.savePackage", () => {
  it("refuses a system-library package before reading its source", async () => {
    const listFile = vi.fn(() => Promise.resolve({ contents: "" }));
    const setSourceFile = vi.fn(() => Promise.resolve({}));
    const client = {
      listFile,
      setSourceFile,
      getSourceFile: vi.fn(() =>
        Promise.resolve({
          fileName: `${MODELICA_PATH}/Modelica 4.0.0/Blocks/package.mo`,
        }),
      ),
      getModelicaPath: vi.fn(() =>
        Promise.resolve({ modelicaPath: MODELICA_PATH }),
      ),
      getClassInformation: vi.fn(() =>
        Promise.resolve({ fileReadOnly: false }),
      ),
    } as unknown as OmcClient;
    const ctx = {
      ensureClient: () => Promise.resolve(client),
      writeVerdicts: new WriteVerdicts(),
    } as unknown as CommandContext;
    registerPackageCommands(ctx);

    await runCommand("modelica.savePackage", NODE);

    expect(listFile).not.toHaveBeenCalled();
    expect(setSourceFile).not.toHaveBeenCalled();
  });
});
