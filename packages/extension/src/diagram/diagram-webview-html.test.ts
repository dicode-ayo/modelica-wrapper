/**
 * `renderDiagramWebviewHtml` is a thin wrapper over the shared
 * `renderWebviewPage` (see `webview/webview-page.test.ts` for the CSP/nonce/
 * escaping invariants that module owns), but it's the one call site that
 * overrides `bodyStyle` — a fixed light canvas rather than following the
 * VSCode theme (Modelica convention). That override has no other test
 * anywhere, so this pins it directly rather than relying on the shared
 * suite's default-style coverage.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { describe, expect, it } from "vitest";
import * as vscode from "vscode";

import { renderDiagramWebviewHtml } from "./diagram-webview-html.js";

const EXT_URI = vscode.Uri.file("/ext");

function fakeWebview(): vscode.Webview {
  return {
    cspSource: "vscode-webview:",
    asWebviewUri: (u: vscode.Uri) => u,
  } as unknown as vscode.Webview;
}

describe("renderDiagramWebviewHtml", () => {
  it("boots the diagram root and its bundle, titled with the class name", () => {
    const html = renderDiagramWebviewHtml(
      fakeWebview(),
      EXT_URI,
      "Modelica.Blocks.Continuous.PID",
    );
    expect(html).toContain("<om-webview-root></om-webview-root>");
    expect(html).toContain("out/webview.js");
    expect(html).toContain("out/webview.css");
    expect(html).toContain(
      "<title>Modelica diagram: Modelica.Blocks.Continuous.PID</title>",
    );
  });

  it("fixes the canvas to a light background rather than following the VSCode theme", () => {
    const html = renderDiagramWebviewHtml(fakeWebview(), EXT_URI, "Foo");
    expect(html).toContain("background: #f7f7f8");
  });
});
