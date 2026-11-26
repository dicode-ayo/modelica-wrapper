/**
 * `modelica.initializeWorkspaceAsPackage` must write into the folder the user
 * picked in a multi-root window, and write nothing when the pick is dismissed.
 *
 * `modelica.savePackage` must refuse a system-library class before it prompts
 * for a target: its `setSourceFile` would repoint the class off MODELICAPATH,
 * stripping origin-based read-only detection from the whole subtree.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OmcClient } from "@dicode/omc-client";

import {
  queuePromptAnswers,
  queueWorkspaceFolderPick,
  recordedMessages,
  resetCommands,
  runCommand,
  setWorkspaceFolders,
} from "../../test-support/vscode-mock.js";
import { createSelfWriteGuard } from "../self-write-guard.js";
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
  beforeEach(() => {
    resetCommands();
    recordedMessages.length = 0;
  });

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

    expect(setSourceFile).not.toHaveBeenCalled();
    // The mock has no `showSaveDialog`, so a passing verdict would also leave
    // `listFile` untouched — only the refusal sentence proves the gate ran, and
    // it can only have been produced before the dialog.
    expect(listFile).not.toHaveBeenCalled();
    expect(recordedMessages).toContainEqual({
      level: "error",
      message:
        "Modelica: Cannot save Modelica.Blocks — it belongs to a read-only system library.",
    });
  });
});

describe("modelica.initializeWorkspaceAsPackage in a multi-root window", () => {
  let first: string;
  let second: string;
  let loadString: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    resetCommands();
    recordedMessages.length = 0;
    first = await fsp.mkdtemp(path.join(os.tmpdir(), "initpkg-first-"));
    second = await fsp.mkdtemp(path.join(os.tmpdir(), "initpkg-second-"));
    setWorkspaceFolders([first, second]);
    loadString = vi.fn(() => Promise.resolve({ success: true }));
    const client = {
      loadString,
      getErrorString: vi.fn(() => Promise.resolve({ errorString: "" })),
      setSourceFile: vi.fn(() => Promise.resolve({})),
    } as unknown as OmcClient;
    const ctx = {
      ensureClient: () => Promise.resolve(client),
      libraryTree: { childrenChanged: vi.fn() },
      sourceProvider: { notifySourceChanged: vi.fn() },
      selfWriteGuard: createSelfWriteGuard(),
    } as unknown as CommandContext;
    registerPackageCommands(ctx);
  });

  afterEach(async () => {
    await fsp.rm(first, { recursive: true, force: true });
    await fsp.rm(second, { recursive: true, force: true });
  });

  it("writes package.mo into the picked folder, not folder 0", async () => {
    queueWorkspaceFolderPick(1);
    queuePromptAnswers("Second");

    await runCommand("modelica.initializeWorkspaceAsPackage");

    await expect(
      fsp.readFile(path.join(second, "package.mo"), "utf8"),
    ).resolves.toBe("package Second\nend Second;\n");
    await expect(fsp.readdir(first)).resolves.toEqual([]);
  });

  it("writes nothing when the folder pick is dismissed", async () => {
    queueWorkspaceFolderPick(undefined);
    queuePromptAnswers("Second");

    await runCommand("modelica.initializeWorkspaceAsPackage");

    expect(loadString).not.toHaveBeenCalled();
    await expect(fsp.readdir(first)).resolves.toEqual([]);
    await expect(fsp.readdir(second)).resolves.toEqual([]);
  });
});
