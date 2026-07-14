/**
 * The documentation webview HTML boots the `out/documentation.js` bundle under
 * a locked-down CSP. These pin the invariants the sanitized-render path relies
 * on: `script-src` is nonce-only (so markup carried in the doc HTML can't
 * execute) and the class name is escaped into the title.
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
  it("boots the documentation root and its bundle", () => {
    const html = renderDocumentationWebviewHtml(
      fakeWebview(),
      EXT_URI,
      "Modelica.Blocks.Continuous.PID",
    );
    expect(html).toContain("<om-documentation-root></om-documentation-root>");
    expect(html).toContain("out/documentation.js");
  });

  it("locks script execution to the nonce, never unsafe-inline", () => {
    const html = renderDocumentationWebviewHtml(fakeWebview(), EXT_URI, "Foo");
    const scriptSrc = /script-src ([^;]*)/.exec(html)?.[1] ?? "";
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9]+'/);
    expect(scriptSrc).not.toContain("unsafe-inline");
    // The single <script> tag must carry the same nonce, or it won't run.
    const nonce = /'nonce-([A-Za-z0-9]+)'/.exec(html)?.[1];
    expect(html).toContain(`nonce="${nonce}"`);
  });

  it("escapes the class name into the title", () => {
    const html = renderDocumentationWebviewHtml(
      fakeWebview(),
      EXT_URI,
      'Evil<script>"&',
    );
    expect(html).toContain("Evil&lt;script&gt;&quot;&amp;");
    expect(html).not.toContain("<title>Modelica documentation: Evil<script>");
  });
});
