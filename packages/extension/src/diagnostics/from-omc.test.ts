import { describe, expect, it } from "vitest";
import * as vscode from "vscode";

import type { ErrorMessage } from "@modelica-wrapper/omc-client";

import { mapOmcMessagesToDiagnostics, rangeFromInfo, severityFromLevel } from "./from-omc.js";

function makeMessage(overrides: Partial<ErrorMessage>): ErrorMessage {
  return {
    info: {
      filename: "/tmp/a.mo",
      readonly: false,
      lineStart: 1,
      columnStart: 1,
      lineEnd: 1,
      columnEnd: 1,
      ...overrides.info,
    },
    message: overrides.message ?? "some diagnostic",
    kind: overrides.kind ?? "syntax",
    level: overrides.level ?? "error",
    id: overrides.id ?? 1,
  };
}

describe("severityFromLevel", () => {
  it("maps all known levels", () => {
    expect(severityFromLevel("error")).toBe(vscode.DiagnosticSeverity.Error);
    expect(severityFromLevel("warning")).toBe(vscode.DiagnosticSeverity.Warning);
    expect(severityFromLevel("notification")).toBe(
      vscode.DiagnosticSeverity.Information,
    );
    expect(severityFromLevel("internal")).toBe(vscode.DiagnosticSeverity.Error);
  });

  it("falls back to Error for unknown levels", () => {
    expect(severityFromLevel("brand-new-level")).toBe(
      vscode.DiagnosticSeverity.Error,
    );
  });
});

describe("rangeFromInfo (1-based → 0-based offsetting)", () => {
  it("converts 1-based source positions to 0-based VSCode positions", () => {
    const r = rangeFromInfo({
      lineStart: 3,
      columnStart: 5,
      lineEnd: 3,
      columnEnd: 10,
    });
    expect(r.start.line).toBe(2);
    expect(r.start.character).toBe(4);
    expect(r.end.line).toBe(2);
    expect(r.end.character).toBe(9);
  });

  it("widens a zero-width range so the squiggle stays visible", () => {
    const r = rangeFromInfo({
      lineStart: 3,
      columnStart: 3,
      lineEnd: 3,
      columnEnd: 3,
    });
    expect(r.start.character).toBe(2);
    expect(r.end.character).toBe(3);
  });

  it("clamps end < start to start", () => {
    const r = rangeFromInfo({
      lineStart: 5,
      columnStart: 2,
      lineEnd: 4,
      columnEnd: 1,
    });
    expect(r.start.line).toBe(4);
    expect(r.end.line).toBe(4);
  });
});

describe("mapOmcMessagesToDiagnostics", () => {
  it("skips diagnostics with filename `<interactive>`", () => {
    const out = mapOmcMessagesToDiagnostics([
      makeMessage({ info: { filename: "<interactive>", readonly: false, lineStart: 1, columnStart: 1, lineEnd: 1, columnEnd: 1 } }),
    ]);
    expect(out.size).toBe(0);
  });

  it("attaches Diagnostic.source and Diagnostic.code", () => {
    const out = mapOmcMessagesToDiagnostics([
      makeMessage({
        info: { filename: "/tmp/x.mo", readonly: false, lineStart: 1, columnStart: 1, lineEnd: 1, columnEnd: 5 },
        kind: "translation",
        level: "warning",
      }),
    ]);
    const [diag] = [...out.values()][0]!;
    expect(diag).toBeDefined();
    expect(diag!.source).toBe("openmodelica");
    expect(diag!.code).toBe("translation");
    expect(diag!.severity).toBe(vscode.DiagnosticSeverity.Warning);
  });

  it("groups multiple diagnostics by Uri (same file → same key)", () => {
    const out = mapOmcMessagesToDiagnostics([
      makeMessage({ info: { filename: "/tmp/a.mo", readonly: false, lineStart: 1, columnStart: 1, lineEnd: 1, columnEnd: 1 } }),
      makeMessage({ info: { filename: "/tmp/a.mo", readonly: false, lineStart: 5, columnStart: 1, lineEnd: 5, columnEnd: 1 } }),
      makeMessage({ info: { filename: "/tmp/b.mo", readonly: false, lineStart: 1, columnStart: 1, lineEnd: 1, columnEnd: 1 } }),
    ]);
    const buckets = [...out.entries()].map(([uri, diags]) => ({
      uri: uri.toString(),
      n: diags.length,
    }));
    // Two unique URIs (a.mo, b.mo) with 2 and 1 diags respectively.
    expect(buckets).toHaveLength(2);
    const aBucket = buckets.find((b) => b.uri.endsWith("a.mo"));
    const bBucket = buckets.find((b) => b.uri.endsWith("b.mo"));
    expect(aBucket?.n).toBe(2);
    expect(bBucket?.n).toBe(1);
  });

  it("uses sourceUriResolver to remap a custom-scheme filename", () => {
    const customUri = vscode.Uri.parse("modelica-source:/Foo.mo");
    const out = mapOmcMessagesToDiagnostics(
      [
        makeMessage({
          info: {
            filename: "modelica-source:/Foo.mo",
            readonly: false,
            lineStart: 1,
            columnStart: 1,
            lineEnd: 1,
            columnEnd: 1,
          },
        }),
      ],
      (filename) =>
        filename === "modelica-source:/Foo.mo" ? customUri : undefined,
    );
    const keys = [...out.keys()].map((u) => u.toString());
    expect(keys).toContain("modelica-source:/Foo.mo");
  });
});
