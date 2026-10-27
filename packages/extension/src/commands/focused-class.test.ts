import { afterEach, describe, expect, it, vi } from "vitest";

import { setActiveTextEditorUri } from "../../test-support/vscode-mock.js";
import { DiagramEditorProvider } from "../diagram/diagram-editor-provider.js";
import { DocumentationEditorProvider } from "../documentation/documentation-editor-provider.js";
import { sourceUriFor } from "../source-provider.js";

import { focusedClass } from "./focused-class.js";

describe("focusedClass", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setActiveTextEditorUri(undefined);
  });

  it("resolves the class of a focused documentation tab", () => {
    vi.spyOn(DiagramEditorProvider, "activeClassName").mockReturnValue(
      undefined,
    );
    vi.spyOn(DocumentationEditorProvider, "activeClassName").mockReturnValue(
      "Pkg.Doc",
    );

    expect(focusedClass()).toBe("Pkg.Doc");
  });

  it("prefers the diagram over the documentation tab", () => {
    vi.spyOn(DiagramEditorProvider, "activeClassName").mockReturnValue(
      "Pkg.Diagram",
    );
    vi.spyOn(DocumentationEditorProvider, "activeClassName").mockReturnValue(
      "Pkg.Doc",
    );

    expect(focusedClass()).toBe("Pkg.Diagram");
  });

  it("falls back to a modelica-source text editor", () => {
    vi.spyOn(DiagramEditorProvider, "activeClassName").mockReturnValue(
      undefined,
    );
    vi.spyOn(DocumentationEditorProvider, "activeClassName").mockReturnValue(
      undefined,
    );
    setActiveTextEditorUri(sourceUriFor("Pkg.Text"));

    expect(focusedClass()).toBe("Pkg.Text");
  });

  it("is undefined when nothing Modelica is focused", () => {
    vi.spyOn(DiagramEditorProvider, "activeClassName").mockReturnValue(
      undefined,
    );
    vi.spyOn(DocumentationEditorProvider, "activeClassName").mockReturnValue(
      undefined,
    );

    expect(focusedClass()).toBeUndefined();
  });
});
