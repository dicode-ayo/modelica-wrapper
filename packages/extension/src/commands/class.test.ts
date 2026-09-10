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

import { registerClassCommands, resolveRootPackageParent } from "./class.js";
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
      Promise.resolve({ fileReadOnly: false, fileName: sourceFile }),
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

    it("still runs the first-time-content prompt for a plain nested subdirectory package, not the root guard", async () => {
      // Sanity check that the new root-package.mo branch doesn't swallow the
      // sibling case: a workspace with content but no root package.mo (e.g.
      // only a subdirectory package) still falls through to the pre-existing
      // hasModelicaContent branch rather than the new refusal/resolve path.
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
      // consulted and the plain top-level write proceeds unguarded, exactly
      // as it did before this issue's fix.
      expect(parseFile).not.toHaveBeenCalled();
      expect(loadString).toHaveBeenCalledWith(
        expect.objectContaining({ data: "model MyModel\nend MyModel;\n" }),
      );
    });
  });
});

describe("resolveRootPackageParent", () => {
  const ROOT_PKG = "/ws/package.mo";

  it("resolves the single class a root package.mo declares", async () => {
    const client = {
      parseFile: vi.fn(() => Promise.resolve({ classNames: ["RootPkg"] })),
    };

    const result = await resolveRootPackageParent(client, ROOT_PKG);

    expect(result).toEqual({ ok: true, parent: "RootPkg" });
  });

  it("refuses when the file declares no parseable class", async () => {
    const client = {
      parseFile: vi.fn(() => Promise.resolve({ classNames: [] })),
    };

    const result = await resolveRootPackageParent(client, ROOT_PKG);

    expect(result).toEqual({
      ok: false,
      reason: `${ROOT_PKG} declares no class OMC could parse`,
    });
  });

  it("refuses when the file declares more than one top-level class, naming them", async () => {
    const client = {
      parseFile: vi.fn(() => Promise.resolve({ classNames: ["A", "B"] })),
    };

    const result = await resolveRootPackageParent(client, ROOT_PKG);

    expect(result).toEqual({
      ok: false,
      reason: `${ROOT_PKG} declares more than one top-level class (A, B)`,
    });
  });

  it("refuses rather than throwing when parseFile itself fails", async () => {
    const client = {
      parseFile: vi.fn(() => Promise.reject(new Error("omc gone"))),
    };

    const result = await resolveRootPackageParent(client, ROOT_PKG);

    expect(result).toEqual({
      ok: false,
      reason: `could not read ${ROOT_PKG}'s class name (omc gone)`,
    });
  });
});
