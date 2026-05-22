import { describe, expect, it } from "vitest";

import type { ResultViewDoc } from "@modelica-wrapper/omc-client";

import {
  parseResultViewDoc,
  serializeResultViewDoc,
  traceCacheKey,
  tracesNeedingData,
} from "./result-doc.js";

// A fully-populated document with no `undefined` fields, so a parse∘serialize
// round-trip should reproduce it exactly.
const FULL_DOC: ResultViewDoc = {
  version: 1,
  results: [
    {
      id: "r1",
      label: "DCMotor run-1",
      path: "DCMotor_res.mat",
      model: "Lib.DCMotor",
      source: "simulate",
      createdAt: "2026-05-22T09:00:00.000Z",
      parameters: { "motor.R": "0.5" },
      commit: "abc1234",
      dirty: true,
    },
    {
      id: "r2",
      label: "tank.mat",
      path: "/abs/tank.mat",
      source: "import",
      commit: null,
      dirty: null,
    },
  ],
  cards: [
    {
      kind: "plot",
      title: "Speeds",
      xVariable: "time",
      traces: [
        { result: "r1", variable: "motor.w" },
        { result: "r2", variable: "tank.level" },
      ],
    },
  ],
};

const EMPTY: ResultViewDoc = { version: 1, results: [], cards: [] };

describe("parseResultViewDoc", () => {
  it("returns an empty doc on invalid JSON or a non-object top level", () => {
    expect(parseResultViewDoc("not json")).toEqual(EMPTY);
    expect(parseResultViewDoc("42")).toEqual(EMPTY);
    expect(parseResultViewDoc("null")).toEqual(EMPTY);
  });

  it("round-trips a full document", () => {
    expect(parseResultViewDoc(serializeResultViewDoc(FULL_DOC))).toEqual(FULL_DOC);
  });

  it("drops malformed result entries but keeps valid ones", () => {
    const text = JSON.stringify({
      version: 1,
      results: [
        { id: "ok", label: "ok", path: "a.mat", source: "import" },
        { id: "bad-missing-source", label: "x", path: "b.mat" },
        { id: 7, label: "bad-id-type", path: "c.mat", source: "import" },
      ],
      cards: [],
    });
    expect(parseResultViewDoc(text).results.map((r) => r.id)).toEqual(["ok"]);
  });

  it("defaults a card with no kind to a plot", () => {
    const text = JSON.stringify({
      version: 1,
      results: [],
      cards: [{ title: "Untyped", traces: [{ result: "r1", variable: "x" }] }],
    });
    expect(parseResultViewDoc(text).cards).toEqual([
      { kind: "plot", title: "Untyped", traces: [{ result: "r1", variable: "x" }] },
    ]);
  });

  it("accepts a `plots` array as an alias for `cards`", () => {
    const text = JSON.stringify({ version: 1, results: [], plots: [{ kind: "plot", title: "Aliased" }] });
    expect(parseResultViewDoc(text).cards).toEqual([{ kind: "plot", title: "Aliased" }]);
  });

  it("normalises version to 1 even when absent or different", () => {
    expect(parseResultViewDoc(JSON.stringify({ results: [], cards: [] })).version).toBe(1);
    expect(parseResultViewDoc(JSON.stringify({ version: 99, results: [], cards: [] })).version).toBe(1);
  });

  it("drops a card with an unknown extra field (strict)", () => {
    const text = JSON.stringify({ version: 1, results: [], cards: [{ kind: "plot", bogus: true }] });
    expect(parseResultViewDoc(text).cards).toEqual([]);
  });
});

describe("serializeResultViewDoc", () => {
  it("is deterministic, fixed key order, trailing newline", () => {
    const out = serializeResultViewDoc(FULL_DOC);
    expect(out).toBe(serializeResultViewDoc(FULL_DOC));
    expect(out.endsWith("\n")).toBe(true);
    expect(out.indexOf('"id"')).toBeLessThan(out.indexOf('"label"'));
    expect(out.indexOf('"label"')).toBeLessThan(out.indexOf('"path"'));
  });

  it("drops undefined fields but keeps null commit/dirty", () => {
    const doc: ResultViewDoc = {
      version: 1,
      results: [{ id: "r", label: "r", path: "r.mat", source: "import", commit: null, dirty: null }],
      cards: [],
    };
    const out = serializeResultViewDoc(doc);
    expect(out).not.toContain('"model"');
    expect(out).toContain('"commit": null');
    expect(out).toContain('"dirty": null');
  });

  it("throws on an in-code document that violates the schema", () => {
    const bad = {
      version: 1,
      results: [{ id: "r", label: "r", path: "r.mat", source: "bogus" }],
      cards: [],
    } as unknown as ResultViewDoc;
    expect(() => serializeResultViewDoc(bad)).toThrow();
  });
});

describe("tracesNeedingData", () => {
  const doc: ResultViewDoc = {
    version: 1,
    results: [
      { id: "r1", label: "r1", path: "a.mat", source: "import" },
      { id: "r2", label: "r2", path: "b.mat", source: "import" },
    ],
    cards: [
      {
        kind: "plot",
        traces: [
          { result: "r1", variable: "x" },
          { result: "r1", variable: "y" },
          { result: "r2", variable: "z" },
          { result: "ghost", variable: "q" }, // dangling — result not in doc
        ],
      },
    ],
  };

  it("returns every uncached, existing-result trace grouped by result", () => {
    const needed = tracesNeedingData(doc, new Set());
    expect([...(needed.get("r1") ?? [])].sort()).toEqual(["x", "y"]);
    expect([...(needed.get("r2") ?? [])]).toEqual(["z"]);
  });

  it("skips dangling traces whose result is gone", () => {
    expect(tracesNeedingData(doc, new Set()).has("ghost")).toBe(false);
  });

  it("excludes already-cached pairs", () => {
    const needed = tracesNeedingData(doc, new Set([traceCacheKey("r1", "x")]));
    expect([...(needed.get("r1") ?? [])]).toEqual(["y"]);
  });

  it("returns an empty map when everything is cached", () => {
    const cached = new Set([
      traceCacheKey("r1", "x"),
      traceCacheKey("r1", "y"),
      traceCacheKey("r2", "z"),
    ]);
    expect(tracesNeedingData(doc, cached).size).toBe(0);
  });
});
