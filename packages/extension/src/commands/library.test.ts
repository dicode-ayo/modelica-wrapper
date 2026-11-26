/**
 * `modelica.loadLibrary` turns each load-or-install outcome into what the user
 * sees: the install prompt, its progress notification, and which OMC error the
 * final toast carries.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OmcClient } from "@dicode/omc-client";

import {
  progressRuns,
  queueMessageAnswers,
  queuePromptAnswers,
  recordedMessages,
  recordedPrompts,
  resetCommands,
  resetMessages,
  resetProgressRuns,
  runCommand,
} from "../../test-support/vscode-mock.js";

import type { CommandContext } from "./context.js";
import { registerLibraryCommands } from "./library.js";

const LOAD_ERROR =
  "Error: Failed to load package Modelica (default) using MODELICAPATH ~/.openmodelica/libraries/.";

function setup(opts: { install?: boolean; errors?: string[] } = {}) {
  const errors = [...(opts.errors ?? [LOAD_ERROR])];
  const loadModel = vi
    .fn()
    .mockResolvedValueOnce({ success: false })
    .mockResolvedValue({ success: true });
  const installPackage = vi.fn(() =>
    Promise.resolve({ result: opts.install ?? true }),
  );
  const client = {
    loadModel,
    installPackage,
    getErrorString: vi.fn(() =>
      Promise.resolve({ errorString: errors.shift() ?? "" }),
    ),
    getAvailablePackageVersions: vi.fn(() =>
      Promise.resolve({ withoutConversion: ["4.1.0+maint.om"] }),
    ),
    updatePackageIndex: vi.fn(() => Promise.resolve({ result: true })),
  } as unknown as OmcClient;
  const childrenChanged = vi.fn();
  const ctx = {
    ensureClient: () => Promise.resolve(client),
    libraryTree: { childrenChanged },
  } as unknown as CommandContext;
  registerLibraryCommands(ctx);
  return { installPackage, loadModel, childrenChanged };
}

describe("modelica.loadLibrary", () => {
  beforeEach(() => {
    resetCommands();
    resetMessages();
    resetProgressRuns();
  });

  it("asks to install the missing library and refreshes the tree once it loads", async () => {
    const { installPackage, childrenChanged } = setup();
    queuePromptAnswers("Modelica");
    queueMessageAnswers("Install");

    await runCommand("modelica.loadLibrary");

    expect(recordedPrompts).toEqual([
      expect.objectContaining({
        message: "Modelica: Modelica is not installed. Install Modelica 4.1.0?",
        items: ["Install", "Cancel"],
      }),
    ]);
    expect(progressRuns.map((r) => r.title)).toEqual([
      "Modelica: Installing Modelica 4.1.0…",
    ]);
    expect(installPackage).toHaveBeenCalledWith({
      typeName: "Modelica",
      version: "4.1.0+maint.om",
      exactMatch: true,
    });
    expect(childrenChanged).toHaveBeenCalledWith(null);
    expect(recordedMessages.filter((m) => m.level === "error")).toEqual([]);
  });

  it("shows the original load error when the install is declined", async () => {
    const { installPackage, childrenChanged } = setup();
    queuePromptAnswers("Modelica");
    queueMessageAnswers("Cancel");

    await runCommand("modelica.loadLibrary");

    expect(installPackage).not.toHaveBeenCalled();
    expect(childrenChanged).not.toHaveBeenCalled();
    expect(recordedMessages).toContainEqual({
      level: "error",
      message: `Modelica: failed to load Modelica: ${LOAD_ERROR}`,
    });
  });

  it("shows OMC's install error rather than the earlier load error", async () => {
    const networkError =
      "Error: Failed to download https://example/Modelica.zip";
    const { childrenChanged } = setup({
      install: false,
      errors: [LOAD_ERROR, networkError],
    });
    queuePromptAnswers("Modelica");
    queueMessageAnswers("Install");

    await runCommand("modelica.loadLibrary");

    expect(childrenChanged).not.toHaveBeenCalled();
    expect(recordedMessages).toContainEqual({
      level: "error",
      message: `Modelica: failed to install Modelica 4.1.0+maint.om: ${networkError}`,
    });
  });
});
