/**
 * `renderWebviewPage`/`renderPlaceholderPage` are the one place every webview
 * host's CSP-locked HTML shell is built. These pin the CSP shape (nonce-only
 * `script-src`, no `img-src`/`script-src` at all on the placeholder), that a
 * title is HTML-escaped, and that each entry's bundle URL and stylesheet-link
 * decision stay in sync with the facts they claim: the bundle name against
 * `esbuild.config.mjs`'s own `outfile`s, the stylesheet decision against
 * whether that entry's `*-entry.ts` itself imports any CSS. Either drifting
 * should fail a test rather than boot a blank or 404'd webview.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import * as vscode from "vscode";

import {
  ALL_WEBVIEW_ENTRIES,
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

  it("links the sibling .css next to its own bundle when it links one at all", () => {
    // Which entries link one at all is pinned below, in "WebviewEntry naming".
    const html = renderWebviewPage({
      webview: fakeWebview(),
      extensionUri: EXT_URI,
      entry: "webview",
      title: "Foo",
      root: "<om-webview-root></om-webview-root>",
    });
    expect(html).toContain("out/webview.css");
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

describe("WebviewEntry naming", () => {
  it("every entry's bundle name is a real esbuild.config.mjs outfile", () => {
    const configPath = fileURLToPath(
      new URL("../../esbuild.config.mjs", import.meta.url),
    );
    const config = readFileSync(configPath, "utf8");
    const outfiles = [...config.matchAll(/outfile:\s*"out\/([^"]+\.js)"/g)]
      .map((m) => m[1])
      // extension.js is extensionConfig's outfile — the Node-side host
      // bundle, built by a separate esbuild config with no webview page.
      .filter((f): f is string => f !== undefined && f !== "extension.js");

    const bundles = ALL_WEBVIEW_ENTRIES.map((entry) => `${entry}.js`);
    expect(new Set(bundles)).toEqual(new Set(outfiles));
  });

  it("links a stylesheet exactly for the entries whose own source imports CSS", () => {
    for (const entry of ALL_WEBVIEW_ENTRIES) {
      const entryPath = fileURLToPath(
        new URL(`./${entry}-entry.ts`, import.meta.url),
      );
      const source = readFileSync(entryPath, "utf8");
      // Today that's always `webawesome-setup`'s own `import "*.css"`, but a
      // direct `.css` import would make esbuild collect one too — check for
      // either, not just the one specifier that happens to exist right now.
      const importsCss = /^import ".*(?:webawesome-setup|\.css)";$/m.test(
        source,
      );
      const html = renderWebviewPage({
        webview: fakeWebview(),
        extensionUri: EXT_URI,
        entry,
        title: "Foo",
        root: "<x></x>",
      });
      expect(html.includes("<link")).toBe(importsCss);
    }
  });
});
