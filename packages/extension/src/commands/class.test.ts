/**
 * `modelica.createClass` consults the write verdict for the parent it would
 * nest under — and only then. A top-level class has no parent to judge, so a
 * verdict lookup there would refuse creation on whatever unrelated class the
 * name happens to collide with.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OmcClient } from "@dicode/omc-client";

import {
  queuePromptAnswers,
  resetCommands,
  runCommand,
} from "../../test-support/vscode-mock.js";
import { WriteVerdicts } from "../write-verdict.js";

import { registerClassCommands } from "./class.js";
import type { CommandContext, LibraryNode } from "./context.js";

const MODELICA_PATH = "/home/u/.openmodelica/libraries";

function makeContext(sourceFile: string): {
  ctx: CommandContext;
  verdicts: WriteVerdicts;
  loadString: ReturnType<typeof vi.fn>;
} {
  const loadString = vi.fn(() => Promise.resolve({ success: true }));
  const client = {
    loadString,
    getErrorString: vi.fn(() => Promise.resolve({ errorString: "" })),
    getSourceFile: vi.fn(() => Promise.resolve({ fileName: sourceFile })),
    getModelicaPath: vi.fn(() =>
      Promise.resolve({ modelicaPath: MODELICA_PATH }),
    ),
    getClassInformation: vi.fn(() => Promise.resolve({ fileReadOnly: false })),
  } as unknown as OmcClient;
  const verdicts = new WriteVerdicts();
  const ctx = {
    ensureClient: () => Promise.resolve(client),
    writeVerdicts: verdicts,
    libraryTree: { childrenChanged: vi.fn() },
    sourceProvider: { notifySourceChanged: vi.fn() },
  } as unknown as CommandContext;
  return { ctx, verdicts, loadString };
}

function packageNode(qualifiedName: string): LibraryNode {
  return {
    qualifiedName,
    displayName: qualifiedName,
    restriction: "package",
  };
}

describe("modelica.createClass", () => {
  beforeEach(resetCommands);

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
  });

  it("creates inside a workspace package", async () => {
    const { ctx, loadString } = makeContext("/ws/Pkg/package.mo");
    registerClassCommands(ctx);
    queuePromptAnswers("model", "MyModel");

    await runCommand("modelica.createClass", packageNode("Pkg"));

    expect(loadString).toHaveBeenCalled();
  });
});
