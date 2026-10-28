import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { setActiveTextEditorUri } from "../../test-support/vscode-mock.js";
import { DiagramEditorProvider } from "../diagram/diagram-editor-provider.js";
import { DocumentationEditorProvider } from "../documentation/documentation-editor-provider.js";
import { sourceUriFor } from "../source-provider.js";

import { focusedClass } from "./focused-class.js";

describe("focusedClass", () => {
  let diagram: ReturnType<typeof vi.spyOn>;
  let documentation: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    diagram = vi
      .spyOn(DiagramEditorProvider, "activeClassName")
      .mockReturnValue(undefined);
    documentation = vi
      .spyOn(DocumentationEditorProvider, "activeClassName")
      .mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setActiveTextEditorUri(undefined);
  });

  it("resolves the class of a focused documentation tab", () => {
    documentation.mockReturnValue("Pkg.Doc");

    expect(focusedClass()).toBe("Pkg.Doc");
  });

  it("prefers the diagram over the documentation tab", () => {
    diagram.mockReturnValue("Pkg.Diagram");
    documentation.mockReturnValue("Pkg.Doc");

    expect(focusedClass()).toBe("Pkg.Diagram");
  });

  it("prefers a custom editor over the active text editor", () => {
    diagram.mockReturnValue("Pkg.Diagram");
    setActiveTextEditorUri(sourceUriFor("Pkg.Text"));

    expect(focusedClass()).toBe("Pkg.Diagram");
  });

  it("falls back to a modelica-source text editor", () => {
    setActiveTextEditorUri(sourceUriFor("Pkg.Text"));

    expect(focusedClass()).toBe("Pkg.Text");
  });

  it("ignores a text editor that is not a modelica-source document", () => {
    setActiveTextEditorUri(vscode.Uri.file("/tmp/x.mo"));

    expect(focusedClass()).toBeUndefined();
  });

  it("is undefined when nothing Modelica is focused", () => {
    expect(focusedClass()).toBeUndefined();
  });
});
