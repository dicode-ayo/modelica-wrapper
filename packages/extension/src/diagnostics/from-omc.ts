/**
 * Pure mapper from OMC structured diagnostics (the `ErrorMessage[]` shape
 * returned by `client.getMessagesStringInternal()`) to VSCode
 * `Diagnostic`s, grouped by `Uri`.
 *
 * The mapper is dependency-free aside from `vscode` so it can be unit-tested
 * without spinning up an OMC client.
 *
 * Conventions:
 *  - OMC reports 1-based line/column; VSCode is 0-based. We subtract 1 on
 *    both axes. Zero-width ranges (lineEnd == lineStart && columnEnd ==
 *    columnStart) get their columnEnd nudged by 1 so the squiggle is visible.
 *  - OMC's `level` maps to `DiagnosticSeverity`:
 *      error        → Error
 *      warning      → Warning
 *      notification → Information
 *      internal     → Error  (OMC docs: bug-bait; surface as error)
 *      other        → Error  (forward-compat: any unknown level is critical)
 *  - `Diagnostic.source` is always `"openmodelica"`; `Diagnostic.code` is the
 *    raw `kind` tag (e.g. "syntax", "translation") so users can filter.
 *  - Diagnostics for `<interactive>` are dropped — VSCode has no URI to
 *    attach them to. The caller surfaces these via the output channel.
 *  - A `sourceUriResolver` can map filenames (e.g. `modelica-source:/Foo.mo`
 *    URIs we pass to `loadString`) back to the canonical document URI so the
 *    squiggle renders in the right buffer.
 */

import * as vscode from "vscode";

import type { ErrorMessage } from "@dicode/omc-client";

/** Resolves a filename (as OMC saw it) to a VSCode Uri, or undefined to fall
 * back to `Uri.file(filename)`. */
export type SourceUriResolver = (filename: string) => vscode.Uri | undefined;

/** Convert OMC's structured messages to VSCode diagnostics, grouped by Uri. */
export function mapOmcMessagesToDiagnostics(
  messages: readonly ErrorMessage[],
  sourceUriResolver?: SourceUriResolver,
): Map<vscode.Uri, vscode.Diagnostic[]> {
  // Group by URI string so .get() works (Uri instances aren't reference-equal
  // across constructions). We materialize the keying-by-Uri map at the end.
  const byKey = new Map<string, { uri: vscode.Uri; diags: vscode.Diagnostic[] }>();
  for (const msg of messages) {
    const filename = msg.info.filename;
    // Drop in-memory diagnostics — no URI to attach them to.
    if (filename === "<interactive>" || filename === "") continue;
    const uri = sourceUriResolver?.(filename) ?? vscode.Uri.file(filename);
    const range = rangeFromInfo(msg.info);
    const severity = severityFromLevel(msg.level);
    const diag = new vscode.Diagnostic(range, msg.message, severity);
    diag.source = "openmodelica";
    diag.code = msg.kind;
    const key = uri.toString();
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { uri, diags: [] };
      byKey.set(key, bucket);
    }
    bucket.diags.push(diag);
  }
  const out = new Map<vscode.Uri, vscode.Diagnostic[]>();
  for (const { uri, diags } of byKey.values()) {
    out.set(uri, diags);
  }
  return out;
}

/** Map OMC ErrorLevel → VSCode DiagnosticSeverity. Unknown levels = Error. */
export function severityFromLevel(level: string): vscode.DiagnosticSeverity {
  switch (level) {
    case "warning":
      return vscode.DiagnosticSeverity.Warning;
    case "notification":
      return vscode.DiagnosticSeverity.Information;
    case "internal":
    case "error":
      return vscode.DiagnosticSeverity.Error;
    default:
      return vscode.DiagnosticSeverity.Error;
  }
}

/**
 * Build a VSCode Range from OMC's 1-based SourceInfo. Clamps any negative
 * offsets to 0 and widens zero-width ranges by one column so the squiggle
 * actually renders.
 */
export function rangeFromInfo(info: {
  lineStart: number;
  columnStart: number;
  lineEnd: number;
  columnEnd: number;
}): vscode.Range {
  const lineStart = Math.max(0, info.lineStart - 1);
  const columnStart = Math.max(0, info.columnStart - 1);
  let lineEnd = Math.max(0, info.lineEnd - 1);
  let columnEnd = Math.max(0, info.columnEnd - 1);
  if (lineEnd < lineStart) {
    lineEnd = lineStart;
    columnEnd = columnStart;
  }
  if (lineEnd === lineStart && columnEnd <= columnStart) {
    columnEnd = columnStart + 1;
  }
  return new vscode.Range(lineStart, columnStart, lineEnd, columnEnd);
}
