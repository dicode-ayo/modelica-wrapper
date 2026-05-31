/**
 * Pure mapper from OMC `ErrorMessage[]` to VSCode `Diagnostic`s, grouped by `Uri`.
 *
 *   - `Diagnostic.source` is `"openmodelica"`, `Diagnostic.code` is the raw
 *     `kind` tag (e.g. "syntax", "translation") so users can filter.
 *   - Unknown `level` values map to Error (forward-compat: assume critical).
 *   - `<interactive>` / empty filenames are dropped — no URI to attach to.
 *     The caller surfaces these via the output channel.
 *   - `sourceUriResolver` lets the caller redirect a `modelica-source:/Foo.mo`
 *     filename back to the canonical document URI.
 */

import * as vscode from "vscode";

import type { ErrorMessage } from "@dicode/omc-client";

import { omcToVscodePosition } from "../language/position.js";

/** Maps an OMC filename to a VSCode Uri; `undefined` falls back to `Uri.file`. */
export type SourceUriResolver = (filename: string) => vscode.Uri | undefined;

export function mapOmcMessagesToDiagnostics(
  messages: readonly ErrorMessage[],
  sourceUriResolver?: SourceUriResolver,
): Map<vscode.Uri, vscode.Diagnostic[]> {
  // Key by URI string; Uri instances aren't reference-equal across constructions.
  const byKey = new Map<
    string,
    { uri: vscode.Uri; diags: vscode.Diagnostic[] }
  >();
  for (const msg of messages) {
    const filename = msg.info.filename;
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

/** Unknown levels map to Error. */
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
 * VSCode Range from OMC's `getMessagesStringInternal` `info` block. The 1→0
 * shift uses the shared {@link omcToVscodePosition}; diagnostic-specific
 * tweaks (clamp end-before-start, widen zero-width spans so the squiggle
 * renders) stay here.
 *
 * `columnEnd` is **exclusive** here — `(3,5)..(3,10)` OMC → `(2,4)..(2,9)`.
 * `omcRangeToVscodeRange` in `language/position.ts` treats `getClassInformation`'s
 * end column as **inclusive** instead, because the two OMC APIs disagree. Do
 * not factor these into one helper without reconfirming both conventions.
 */
export function rangeFromInfo(info: {
  lineStart: number;
  columnStart: number;
  lineEnd: number;
  columnEnd: number;
}): vscode.Range {
  const start = omcToVscodePosition(info.lineStart, info.columnStart);
  const rawEnd = omcToVscodePosition(info.lineEnd, info.columnEnd);
  let lineEnd = rawEnd.line;
  let columnEnd = rawEnd.character;
  if (lineEnd < start.line) {
    lineEnd = start.line;
    columnEnd = start.character;
  }
  if (lineEnd === start.line && columnEnd <= start.character) {
    columnEnd = start.character + 1;
  }
  return new vscode.Range(start.line, start.character, lineEnd, columnEnd);
}
