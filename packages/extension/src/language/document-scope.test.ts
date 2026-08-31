/**
 * Unit tests for the document → owning-class + load-on-touch helper.
 *
 * The two paths that matter:
 *   - a virtual `modelica-source:` doc takes its FQN from the path and is NEVER
 *     `loadFile`d (the class is already loaded in OMC) nor `parseFile`d, and
 *   - a real `file:` doc resolves normally and IS loaded on touch.
 *
 * `vscode` is the repo's mock; a minimal fake document supplies just the `uri`
 * fields the helper reads (`scheme` + `fsPath`). The filesystem probe is stubbed
 * so the real-file case stays hermetic.
 */

import { describe, expect, it, vi } from "vitest";

import type * as vscode from "vscode";

import { resolveDocumentOwner } from "./document-scope.js";
import type { FileProbe } from "@dicode/omc-bootstrap";

import type { OwningClassClient } from "./owning-class.js";

/** Minimal fake document exposing only the `uri` fields the helper reads. */
function doc(scheme: string, fsPath: string): vscode.TextDocument {
  return { uri: { scheme, fsPath } } as unknown as vscode.TextDocument;
}

/** A `parseFile` stub that fails the test if it is ever called. */
function clientThatMustNotParse(): OwningClassClient {
  return {
    parseFile: vi.fn(() => {
      throw new Error("parseFile must not run");
    }),
  };
}

const noPackages: FileProbe = () => Promise.resolve(false);

describe("resolveDocumentOwner — virtual modelica-source document", () => {
  it("derives the FQN from the path and skips loadFile + parseFile", async () => {
    const ensureLoaded = vi.fn(() => Promise.resolve(true));
    const client = clientThatMustNotParse();

    const owning = await resolveDocumentOwner(
      doc("modelica-source", "/Modelica.Electrical.Resistor.mo"),
      client,
      { ensureLoaded },
    );

    expect(owning?.qualifiedName).toBe("Modelica.Electrical.Resistor");
    expect(ensureLoaded).not.toHaveBeenCalled();
    expect(client.parseFile).not.toHaveBeenCalled();
  });
});

describe("resolveDocumentOwner — real file document", () => {
  it("resolves the owning class and loads it on touch", async () => {
    const ensureLoaded = vi.fn(() => Promise.resolve(true));
    const client: OwningClassClient = {
      parseFile: vi.fn(() => Promise.resolve({ classNames: [] })),
    };

    const owning = await resolveDocumentOwner(
      doc("file", "/work/Foo.mo"),
      client,
      { ensureLoaded },
      { probe: noPackages },
    );

    expect(owning?.qualifiedName).toBe("Foo");
    expect(ensureLoaded).toHaveBeenCalledWith("/work/Foo.mo");
  });

  it("returns undefined for a non-.mo document and does not load", async () => {
    const ensureLoaded = vi.fn(() => Promise.resolve(true));

    const owning = await resolveDocumentOwner(
      doc("file", "/work/notes.txt"),
      { parseFile: vi.fn(() => Promise.resolve({ classNames: [] })) },
      { ensureLoaded },
      { probe: noPackages },
    );

    expect(owning).toBeUndefined();
    expect(ensureLoaded).not.toHaveBeenCalled();
  });
});
