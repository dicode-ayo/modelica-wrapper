import { Editor } from "@tiptap/core";

import { documentationExtensions } from "./documentation-schema.js";
import { prettyPrintHtml } from "./documentation-pretty.js";

/**
 * A `Documentation(info=…)` string split around its `<html>…</html>` wrapper.
 * Modelica spec §18 uses the wrapper's presence as the HTML-vs-plaintext gate,
 * so it is preserved verbatim (`prefix` holds everything up to and including the
 * opening tag with its attributes; `suffix` holds the closing tag and any
 * trailing text) and only `inner` is handed to the editor.
 */
export interface InfoParts {
  prefix: string;
  inner: string;
  suffix: string;
}

const WRAPPER = /^([\s\S]*?<html[^>]*>)([\s\S]*)(<\/html\s*>[\s\S]*)$/i;

/**
 * Split `info` around its `<html>` wrapper. A string with no wrapper (a
 * plaintext doc) yields empty `prefix`/`suffix` and the whole string as `inner`,
 * so {@link wrapInfo} reassembles it unchanged.
 */
export function splitInfoWrapper(info: string): InfoParts {
  const m = WRAPPER.exec(info);
  if (!m) return { prefix: "", inner: info, suffix: "" };
  return { prefix: m[1] ?? "", inner: m[2] ?? "", suffix: m[3] ?? "" };
}

/** Reassemble an edited `inner` body with the wrapper captured on read. */
export function wrapInfo(inner: string, parts: InfoParts): string {
  return `${parts.prefix}${inner}${parts.suffix}`;
}

/**
 * Serialize an editor's `getHTML()` output into the canonical multi-line body: a
 * pretty-printed HTML block bracketed by newlines so, once wrapped, it reads as
 * `<html>\n…\n</html>` — the form written to the `.mo` and shown in the source
 * editor. The live editor and the headless {@link canonicalizeInner} both route
 * through here so what the user writes and what the golden test checks agree.
 */
export function formatBody(editorHtml: string): string {
  return `\n${prettyPrintHtml(editorHtml)}\n`;
}

/**
 * Round-trip an inner HTML body through the documentation schema and format it:
 * parse to a ProseMirror document, re-serialize, pretty-print. Out-of-schema
 * tags drop out and the result is a fixed point.
 *
 * This runs a headless `Editor` and reads `getHTML()` — the exact call the live
 * editor emits on a real edit — so the canonical form is one the editor actually
 * produces (`@tiptap/html`'s `generateHTML` serializes `<pre><code>` differently).
 */
export function canonicalizeInner(inner: string): string {
  const editor = new Editor({
    extensions: documentationExtensions,
    content: inner,
  });
  try {
    return formatBody(editor.getHTML());
  } finally {
    editor.destroy();
  }
}

/**
 * Canonicalize a whole `info` string: round-trip the inner body while preserving
 * the wrapper verbatim. Idempotent — `canonicalizeInfo(canonicalizeInfo(x))`
 * equals `canonicalizeInfo(x)`.
 */
export function canonicalizeInfo(info: string): string {
  const parts = splitInfoWrapper(info);
  return wrapInfo(canonicalizeInner(parts.inner), parts);
}
