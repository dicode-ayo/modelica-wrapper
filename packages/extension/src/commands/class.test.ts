/**
 * `modelica.createClass` consults the write verdict for the parent it would
 * nest under — and only then. A top-level class has no parent to judge, so a
 * verdict lookup there would refuse creation on whatever unrelated class the
 * name happens to collide with.
 *
 * Also covers the `view/title` toolbar button (no tree node) against a
 * workspace whose root is already a package (issue #626): the command must
 * resolve the one valid destination — the root package itself — rather than
 * writing a `within`-less file that invalidates the whole package on reload.
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
  recordedMessages,
  resetCommands,
  runCommand,
  setWorkspaceFolders,
} from "../../test-support/vscode-mock.js";
import { createSelfWriteGuard } from "../self-write-guard.js";
import { WriteVerdicts } from "../write-verdict.js";

import { registerClassCommands } from "./class.js";
import type { CommandContext, LibraryNode } from "./context.js";

const MODELICA_PATH = "/home/u/.openmodelica/libraries";

function makeContext(sourceFile: string): {
  ctx: CommandContext;
  verdicts: WriteVerdicts;
  loadString: ReturnType<typeof vi.fn>;
  parseFile: ReturnType<typeof vi.fn>;
} {
  const loadString = vi.fn(() => Promise.resolve({ success: true }));
  const parseFile = vi.fn(() => Promise.resolve({ classNames: [] }));
  const client = {
    loadString,
    parseFile,
    getErrorString: vi.fn(() => Promise.resolve({ errorString: "" })),
    getSourceFile: vi.fn(() => Promise.resolve({ fileName: sourceFile })),
    getModelicaPath: vi.fn(() =>
      Promise.resolve({ modelicaPath: MODELICA_PATH }),
    ),
    getClassInformation: vi.fn(() =>
      Promise.resolve({
        fileReadOnly: false,
        fileName: sourceFile,
        restriction: "package",
      }),
    ),
    getClassNames: vi.fn(() => Promise.resolve({ classNames: [] })),
    setSourceFile: vi.fn(() => Promise.resolve({})),
  } as unknown as OmcClient;
  const verdicts = new WriteVerdicts();
  const ctx = {
    ensureClient: () => Promise.resolve(client),
    writeVerdicts: verdicts,
    libraryTree: { childrenChanged: vi.fn() },
    sourceProvider: { notifySourceChanged: vi.fn() },
    selfWriteGuard: createSelfWriteGuard(),
  } as unknown as CommandContext;
  return { ctx, verdicts, loadString, parseFile };
}

function packageNode(qualifiedName: string): LibraryNode {
  return {
    qualifiedName,
    displayName: qualifiedName,
    restriction: "package",
  };
}

describe("modelica.createClass", () => {
  beforeEach(() => {
    resetCommands();
    recordedMessages.length = 0;
  });

  it("creates a top-level class without asking for a verdict", async () => {
    const { ctx, verdicts, loadString } = makeContext("/ws/Pkg/package.mo");
    const forClass = vi.spyOn(verdicts, "forClass");
    registerClassCommands(ctx);
    queuePromptAnswers("model", "MyModel");

    await runCommand("modelica.createClass");

    expect(forClass).not.toHaveBeenCalled();
    expect(loadString).toHaveBeenCalled();
  });

  it("refuses to create inside a system-library package", async () => {
    const { ctx, loadString } = makeContext(
      `${MODELICA_PATH}/Modelica 4.0.0/Blocks/package.mo`,
    );
    registerClassCommands(ctx);
    queuePromptAnswers("model", "MyModel");

    await runCommand("modelica.createClass", packageNode("Modelica.Blocks"));

    // Refused before `loadString`, so nothing lands in the installed library.
    expect(loadString).not.toHaveBeenCalled();
    expect(recordedMessages).toContainEqual({
      level: "error",
      message:
        "Modelica: Cannot create a class inside Modelica.Blocks — it belongs to a read-only system library.",
    });
  });

  it("creates inside a workspace package", async () => {
    const { ctx, loadString } = makeContext("/ws/Pkg/package.mo");
    registerClassCommands(ctx);
    queuePromptAnswers("model", "MyModel");

    await runCommand("modelica.createClass", packageNode("Pkg"));

    expect(loadString).toHaveBeenCalled();
  });

  // The toolbar `+` (view/title, no tree node) against a workspace whose root
  // is already a package — issue #626. `hasModelicaContent` alone doesn't
  // catch this: it's true the moment any `.mo` exists, but only a root
  // `package.mo` makes a within-less write invalid.
  describe("toolbar invocation (no node) with an existing workspace root package", () => {
    let tmp: string;

    beforeEach(async () => {
      tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "createclass-root-"));
      await fsp.writeFile(
        path.join(tmp, "package.mo"),
        "package RootPkg\nend RootPkg;\n",
      );
      setWorkspaceFolders([tmp]);
    });

    afterEach(async () => {
      await fsp.rm(tmp, { recursive: true, force: true });
    });

    it("nests under the resolved root package instead of writing a within-less top-level file", async () => {
      const rootPkg = path.join(tmp, "package.mo");
      const { ctx, loadString, parseFile } = makeContext(rootPkg);
      parseFile.mockResolvedValue({ classNames: ["RootPkg"] });
      registerClassCommands(ctx);
      queuePromptAnswers("model", "MyModel");

      await runCommand("modelica.createClass");

      expect(parseFile).toHaveBeenCalledWith({ fileName: rootPkg });
      expect(loadString).toHaveBeenCalledWith(
        expect.objectContaining({
          data: "within RootPkg;\nmodel MyModel\nend MyModel;\n",
        }),
      );
    });

    it("refuses rather than guessing when the root package doesn't parse to exactly one class", async () => {
      const rootPkg = path.join(tmp, "package.mo");
      const { ctx, loadString, parseFile } = makeContext(rootPkg);
      parseFile.mockResolvedValue({ classNames: [] });
      registerClassCommands(ctx);
      queuePromptAnswers("model", "MyModel");

      await runCommand("modelica.createClass");

      expect(loadString).not.toHaveBeenCalled();
      expect(recordedMessages).toContainEqual({
        level: "error",
        message: `Modelica: cannot create a top-level class here — ${rootPkg} declares no class OMC could parse.`,
      });
    });

    it("proceeds with an unguarded top-level write when the workspace has content but no root package.mo", async () => {
      // A workspace with content but no root package.mo (e.g. only a
      // subdirectory package) has no single valid parent to resolve against,
      // so it takes the hasModelicaContent branch rather than being refused.
      await fsp.rm(path.join(tmp, "package.mo"));
      await fsp.mkdir(path.join(tmp, "Sub"));
      await fsp.writeFile(
        path.join(tmp, "Sub", "package.mo"),
        "package Sub\nend Sub;\n",
      );
      const { ctx, loadString, parseFile } = makeContext(
        path.join(tmp, "Sub", "package.mo"),
      );
      registerClassCommands(ctx);
      queuePromptAnswers("model", "MyModel");

      await runCommand("modelica.createClass");

      // No root package.mo to resolve against, so parseFile is never
      // consulted and the plain top-level write proceeds unguarded.
      expect(parseFile).not.toHaveBeenCalled();
      expect(loadString).toHaveBeenCalledWith(
        expect.objectContaining({ data: "model MyModel\nend MyModel;\n" }),
      );
    });
  });
});
