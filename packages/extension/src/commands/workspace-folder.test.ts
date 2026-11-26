/**
 * In a multi-root window a scaffolding command must ask which folder to write
 * into; a single-root window must keep its no-prompt path.
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
  resetCommands,
  resetMessages,
  runCommand,
  setWorkspaceFolders,
  workspaceFolderPickRequests,
} from "../../test-support/vscode-mock.js";
import { createSelfWriteGuard } from "../self-write-guard.js";
import { WriteVerdicts } from "../write-verdict.js";

import { registerClassCommands } from "./class.js";
import type { CommandContext } from "./context.js";
import { pickWorkspaceFolder } from "./workspace-folder.js";

describe("pickWorkspaceFolder", () => {
  beforeEach(() => {
    resetCommands();
  });

  it("reports no folder when the window has none open", async () => {
    expect(await pickWorkspaceFolder("Folder")).toEqual({ kind: "none" });
    expect(workspaceFolderPickRequests).toEqual([]);
  });

  it("returns the only folder of a single-root window without prompting", async () => {
    setWorkspaceFolders(["/ws/only"]);
    queueWorkspaceFolderPick(undefined);

    const choice = await pickWorkspaceFolder("Folder");

    expect(choice.kind === "picked" && choice.folder.uri.fsPath).toBe(
      "/ws/only",
    );
    expect(workspaceFolderPickRequests).toEqual([]);
  });

  it("asks in a multi-root window and returns the folder the user picked", async () => {
    setWorkspaceFolders(["/ws/one", "/ws/two", "/ws/three"]);
    queueWorkspaceFolderPick(2);

    const choice = await pickWorkspaceFolder("Folder to use");

    expect(choice.kind === "picked" && choice.folder.uri.fsPath).toBe(
      "/ws/three",
    );
    expect(workspaceFolderPickRequests).toEqual(["Folder to use"]);
  });

  it("reports cancellation when the multi-root pick is dismissed", async () => {
    setWorkspaceFolders(["/ws/one", "/ws/two"]);
    queueWorkspaceFolderPick(undefined);

    expect(await pickWorkspaceFolder("Folder")).toEqual({ kind: "cancelled" });
  });
});

describe("modelica.createClass top-level destination in a multi-root window", () => {
  let first: string;
  let second: string;
  let loadString: ReturnType<typeof vi.fn>;
  let parseFile: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    resetCommands();
    resetMessages();
    first = await fsp.mkdtemp(path.join(os.tmpdir(), "createclass-first-"));
    second = await fsp.mkdtemp(path.join(os.tmpdir(), "createclass-second-"));
    // Folder 0 is a root package, so creating against it would nest under
    // `FirstPkg`; the second folder already holds a loose class, so a
    // top-level create there lands at its root without any further prompt.
    await fsp.writeFile(
      path.join(first, "package.mo"),
      "package FirstPkg\nend FirstPkg;\n",
    );
    await fsp.writeFile(
      path.join(second, "Other.mo"),
      "model Other\nend Other;\n",
    );
    setWorkspaceFolders([first, second]);

    loadString = vi.fn(() => Promise.resolve({ success: true }));
    parseFile = vi.fn(() => Promise.resolve({ classNames: ["FirstPkg"] }));
    const client = {
      loadString,
      parseFile,
      getErrorString: vi.fn(() => Promise.resolve({ errorString: "" })),
      getClassNames: vi.fn(() => Promise.resolve({ classNames: [] })),
      setSourceFile: vi.fn(() => Promise.resolve({})),
    } as unknown as OmcClient;
    const ctx = {
      ensureClient: () => Promise.resolve(client),
      writeVerdicts: new WriteVerdicts(),
      libraryTree: { childrenChanged: vi.fn() },
      sourceProvider: { notifySourceChanged: vi.fn() },
      selfWriteGuard: createSelfWriteGuard(),
    } as unknown as CommandContext;
    registerClassCommands(ctx);
  });

  afterEach(async () => {
    await fsp.rm(first, { recursive: true, force: true });
    await fsp.rm(second, { recursive: true, force: true });
  });

  it("resolves and persists against the picked folder, not folder 0", async () => {
    queuePromptAnswers("model", "MyModel");
    queueWorkspaceFolderPick(1);

    await runCommand("modelica.createClass");

    expect(parseFile).not.toHaveBeenCalled();
    expect(loadString).toHaveBeenCalledWith(
      expect.objectContaining({ data: "model MyModel\nend MyModel;\n" }),
    );
    await expect(
      fsp.readFile(path.join(second, "MyModel.mo"), "utf8"),
    ).resolves.toContain("model MyModel");
    await expect(fsp.readdir(first)).resolves.toEqual(["package.mo"]);
  });

  it("creates nothing when the folder pick is dismissed", async () => {
    queuePromptAnswers("model", "MyModel");
    queueWorkspaceFolderPick(undefined);

    await runCommand("modelica.createClass");

    expect(parseFile).not.toHaveBeenCalled();
    expect(loadString).not.toHaveBeenCalled();
    await expect(fsp.readdir(second)).resolves.toEqual(["Other.mo"]);
  });
});
