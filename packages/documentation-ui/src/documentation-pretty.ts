import { html as beautifyHtml, type HTMLBeautifyOptions } from "js-beautify";

// Deterministic, idempotent HTML formatting. `wrap_line_length: 0` never hard-
// wraps mid-text (a break there would change the parsed document), and
// `content_unformatted: ["pre"]` keeps `<pre>` content byte-verbatim — its
// whitespace is significant. Inline tags (a, strong, em, code, …) stay inline by
// js-beautify's defaults, so only block structure gets indented.
const OPTIONS: HTMLBeautifyOptions = {
  indent_size: 2,
  wrap_line_length: 0,
  preserve_newlines: false,
  content_unformatted: ["pre"],
};

/**
 * Pretty-print HTML into indented, multi-line form. Fed `editor.getHTML()`'s
 * single-line output, it yields the multi-line HTML written to the `.mo` and
 * shown in the source editor. Idempotent, and — because it only adds whitespace
 * the schema treats as insignificant — the parse→serialize→format round-trip
 * stays a fixed point.
 */
export function prettyPrintHtml(html: string): string {
  return beautifyHtml(html, OPTIONS);
}
