/**
 * `renderDocumentationWebviewHtml` is a thin wrapper over the shared
 * `renderWebviewPage` (see `webview/webview-page.test.ts` for the CSP/nonce/
 * escaping invariants that module owns). This pins only what's specific to
 * this site: the `documentation` entry, the `<om-documentation-root>` root,
 * and the class name landing in the title.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { describe, expect, it } from "vitest";
import * as vscode from "vscode";

import { renderDocumentationWebviewHtml } from "./documentation-webview-html.js";

const EXT_URI = vscode.Uri.file("/ext");

function fakeWebview(): vscode.Webview {
  return {
    cspSource: "vscode-webview:",
    asWebviewUri: (u: vscode.Uri) => u,
  } as unknown as vscode.Webview;
}

describe("renderDocumentationWebviewHtml", () => {
  it("boots the documentation root and its bundle, titled with the class name", () => {
    const html = renderDocumentationWebviewHtml(
      fakeWebview(),
      EXT_URI,
      "Modelica.Blocks.Continuous.PID",
    );
    expect(html).toContain("<om-documentation-root></om-documentation-root>");
    expect(html).toContain("out/documentation.js");
    expect(html).toContain(
      "<title>Modelica documentation: Modelica.Blocks.Continuous.PID</title>",
    );
  });
});
