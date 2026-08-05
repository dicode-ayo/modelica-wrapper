/**
 * `renderWebviewPage`/`renderPlaceholderPage` are the one place every webview
 * host's CSP-locked HTML shell is built. These pin the CSP shape (nonce-only
 * `script-src`, no `img-src`/`script-src` at all on the placeholder), that a
 * title is HTML-escaped, and that `ENTRY_BUNDLE`'s filenames stay in sync with
 * `esbuild.config.mjs`'s own `outfile`s — a renamed bundle should fail this
 * test rather than boot a blank webview.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import * as vscode from "vscode";

import {
  ENTRY_BUNDLE,
  renderPlaceholderPage,
  renderWebviewPage,
} from "./webview-page.js";

const EXT_URI = vscode.Uri.file("/ext");

function fakeWebview(): vscode.Webview {
  return {
    cspSource: "vscode-webview:",
    asWebviewUri: (u: vscode.Uri) => u,
  } as unknown as vscode.Webview;
}

describe("renderWebviewPage", () => {
  it("boots the given root element and its bundle", () => {
    const html = renderWebviewPage({
      webview: fakeWebview(),
      extensionUri: EXT_URI,
      entry: "webview",
      title: "Modelica diagram: Foo",
      root: "<om-webview-root></om-webview-root>",
    });
    expect(html).toContain("<om-webview-root></om-webview-root>");
    expect(html).toContain("out/webview.js");
  });

  it("locks script execution to a nonce shared with the <script> tag", () => {
    const html = renderWebviewPage({
      webview: fakeWebview(),
      extensionUri: EXT_URI,
      entry: "documentation",
      title: "Foo",
      root: "<om-documentation-root></om-documentation-root>",
    });
    const scriptSrc = /script-src ([^;]*)/.exec(html)?.[1] ?? "";
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9]+'/);
    expect(scriptSrc).not.toContain("unsafe-inline");
    const nonce = /'nonce-([A-Za-z0-9]+)'/.exec(html)?.[1];
    expect(html).toContain(`nonce="${nonce}"`);
  });

  it("escapes the title", () => {
    const html = renderWebviewPage({
      webview: fakeWebview(),
      extensionUri: EXT_URI,
      entry: "webview",
      title: 'Evil<script>"&',
      root: "<om-webview-root></om-webview-root>",
    });
    expect(html).toContain("Evil&lt;script&gt;&quot;&amp;");
    expect(html).not.toContain("<title>Evil<script>");
  });

  it("links a sibling stylesheet only when asked to", () => {
    const withStyles = renderWebviewPage({
      webview: fakeWebview(),
      extensionUri: EXT_URI,
      entry: "webview",
      title: "Foo",
      root: "<om-webview-root></om-webview-root>",
      stylesheet: true,
    });
    expect(withStyles).toContain("out/webview.css");

    const without = renderWebviewPage({
      webview: fakeWebview(),
      extensionUri: EXT_URI,
      entry: "library-view",
      title: "Foo",
      root: "<om-library-view-root></om-library-view-root>",
    });
    expect(without).not.toContain("<link");
  });
});

describe("renderPlaceholderPage", () => {
  it("carries no script-src or img-src — nothing here loads a bundle", () => {
    const html = renderPlaceholderPage({
      cspSource: "vscode-webview:",
      title: "Modelica diagram",
      message: "Open a class.",
    });
    expect(html).not.toContain("script-src");
    expect(html).not.toContain("img-src");
    expect(html).not.toContain("<script");
  });

  it("escapes the title and message", () => {
    const html = renderPlaceholderPage({
      cspSource: "vscode-webview:",
      title: "Foo",
      message: 'Evil<script>"&',
    });
    expect(html).toContain("Evil&lt;script&gt;&quot;&amp;");
    expect(html).not.toContain("<p>Evil<script>");
  });
});

describe("ENTRY_BUNDLE", () => {
  it("stays in sync with esbuild.config.mjs's own outfiles", () => {
    const configPath = fileURLToPath(
      new URL("../../esbuild.config.mjs", import.meta.url),
    );
    const config = readFileSync(configPath, "utf8");
    const outfiles = [...config.matchAll(/outfile:\s*"out\/([^"]+\.js)"/g)]
      .map((m) => m[1])
      .filter((f): f is string => f !== undefined && f !== "extension.js");

    expect(new Set(Object.values(ENTRY_BUNDLE))).toEqual(new Set(outfiles));
  });
});
