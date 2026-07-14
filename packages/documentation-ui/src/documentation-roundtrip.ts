import { Editor } from "@tiptap/core";

import { documentationExtensions } from "./documentation-schema.js";

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
 * Round-trip an inner HTML body through the documentation schema: parse to a
 * ProseMirror document and re-serialize. Out-of-schema tags drop out and the
 * result is a fixed point.
 *
 * This runs a headless `Editor` and reads `getHTML()` — the exact call the live
 * editor emits on a real edit — rather than `@tiptap/html`'s `generateHTML`,
 * which serializes slightly differently (e.g. a leading newline inside
 * `<pre><code>`) and would make this a canonical form the editor never produces.
 */
export function canonicalizeInner(inner: string): string {
  const editor = new Editor({
    extensions: documentationExtensions,
    content: inner,
  });
  try {
    return editor.getHTML();
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
