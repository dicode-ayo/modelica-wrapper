/**
 * Unit tests for the static completion channels: the data contract each channel
 * exposes — kinds, snippet wrapping, and the disjointness between keyword and
 * built-in-type names.
 */

import { describe, expect, it } from "vitest";

import { CompletionCandidateKind } from "./candidate.js";
import {
  builtInTypeCandidates,
  BUILT_IN_TYPES,
  CODE_SNIPPETS,
  keywordCandidates,
  MODELICA_KEYWORDS,
  snippetCandidates,
} from "./static-candidates.js";

describe("static-candidates", () => {
  it("tags built-in types as Class with no insert override", () => {
    const out = builtInTypeCandidates();
    expect(out.map((c) => c.label)).toEqual([...BUILT_IN_TYPES]);
    expect(out.every((c) => c.kind === CompletionCandidateKind.Class)).toBe(
      true,
    );
    expect(out.every((c) => c.insertText === undefined)).toBe(true);
  });

  it("tags keywords as Keyword and inserts the bare word", () => {
    const out = keywordCandidates();
    expect(out.every((c) => c.kind === CompletionCandidateKind.Keyword)).toBe(
      true,
    );
    expect(out.every((c) => c.insertText === undefined)).toBe(true);
    expect(out.map((c) => c.label)).toContain("parameter");
    expect(out.map((c) => c.label)).toContain("extends");
  });

  it("keeps keywords and built-in types disjoint (a name belongs to one channel)", () => {
    const overlap = MODELICA_KEYWORDS.filter((k) =>
      (BUILT_IN_TYPES as readonly string[]).includes(k),
    );
    expect(overlap).toEqual([]);
  });

  it("tags snippets as Snippet with placeholder insertText marked isSnippet", () => {
    const out = snippetCandidates();
    expect(out.every((c) => c.kind === CompletionCandidateKind.Snippet)).toBe(
      true,
    );
    expect(out.every((c) => c.isSnippet === true)).toBe(true);
    // Every snippet body carries at least one placeholder; otherwise wrapping it
    // in a SnippetString would be pointless and a plain keyword would do.
    expect(out.every((c) => (c.insertText ?? "").includes("$"))).toBe(true);
    expect(out.length).toBe(CODE_SNIPPETS.length);
  });

  it("mirrors a class snippet's name into its matching end", () => {
    const model = snippetCandidates().find((c) => c.label === "model");
    expect(model?.insertText).toContain("${1:");
    // The opening name placeholder must reappear at `end <name>;`.
    expect(model?.insertText).toMatch(/end \$\{1:[^}]+\};/);
  });
});
