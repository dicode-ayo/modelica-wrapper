import { describe, expect, it } from "vitest";

import type { ResultViewDoc } from "@dicode/omc-client";

import {
  addPlotCard,
  addResult,
  addTrace,
  deleteCard,
  parseResultViewDoc,
  removeTrace,
  serializeResultViewDoc,
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
      id: "c1",
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
    expect(parseResultViewDoc(serializeResultViewDoc(FULL_DOC))).toEqual(
      FULL_DOC,
    );
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
    expect(parseResultViewDoc(text, () => "c1").cards).toEqual([
      {
        kind: "plot",
        id: "c1",
        title: "Untyped",
        traces: [{ result: "r1", variable: "x" }],
      },
    ]);
  });

  it("accepts a `plots` array as an alias for `cards`", () => {
    const text = JSON.stringify({
      version: 1,
      results: [],
      plots: [{ kind: "plot", id: "c1", title: "Aliased" }],
    });
    expect(parseResultViewDoc(text).cards).toEqual([
      { kind: "plot", id: "c1", title: "Aliased" },
    ]);
  });

  it("backfills a missing card id and preserves an existing one", () => {
    const text = JSON.stringify({
      version: 1,
      results: [],
      cards: [{ kind: "plot", id: "keep" }, { kind: "plot" }],
    });
    expect(
      parseResultViewDoc(text, () => "minted").cards.map((c) => c.id),
    ).toEqual(["keep", "minted"]);
  });

  it("normalises version to 1 even when absent or different", () => {
    expect(
      parseResultViewDoc(JSON.stringify({ results: [], cards: [] })).version,
    ).toBe(1);
    expect(
      parseResultViewDoc(
        JSON.stringify({ version: 99, results: [], cards: [] }),
      ).version,
    ).toBe(1);
  });

  it("drops a card with an unknown extra field (strict)", () => {
    const text = JSON.stringify({
      version: 1,
      results: [],
      cards: [{ kind: "plot", bogus: true }],
    });
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
      results: [
        {
          id: "r",
          label: "r",
          path: "r.mat",
          source: "import",
          commit: null,
          dirty: null,
        },
      ],
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

  it("sorts parameter keys so the output is insertion-order independent", () => {
    const mk = (params: Record<string, string>): ResultViewDoc => ({
      version: 1,
      results: [
        {
          id: "r",
          label: "r",
          path: "r.mat",
          source: "simulate",
          parameters: params,
        },
      ],
      cards: [],
    });
    const a = serializeResultViewDoc(
      mk({ "motor.R": "1", "motor.L": "2", a: "3" }),
    );
    const b = serializeResultViewDoc(
      mk({ a: "3", "motor.L": "2", "motor.R": "1" }),
    );
    expect(a).toBe(b);
    expect(a.indexOf('"a"')).toBeLessThan(a.indexOf('"motor.L"'));
    expect(a.indexOf('"motor.L"')).toBeLessThan(a.indexOf('"motor.R"'));
  });
});

describe("addPlotCard", () => {
  const base: ResultViewDoc = {
    version: 1,
    results: [],
    cards: [
      { kind: "plot", id: "a", title: "Plot 1" },
      { kind: "plot", id: "b", title: "Plot 2" },
    ],
  };

  it("inserts after the given index", () => {
    const out = addPlotCard(base, 0, () => "new");
    expect(out.cards.map((c) => c.id)).toEqual(["a", "new", "b"]);
  });

  it("inserts at the top for afterIndex -1", () => {
    expect(addPlotCard(base, -1, () => "new").cards.map((c) => c.id)).toEqual([
      "new",
      "a",
      "b",
    ]);
  });

  it("appends when afterIndex is at or past the end", () => {
    expect(addPlotCard(base, 99, () => "new").cards.map((c) => c.id)).toEqual([
      "a",
      "b",
      "new",
    ]);
  });

  it("titles with the lowest unused `Plot N` so deletes don't collide", () => {
    const gapped: ResultViewDoc = {
      version: 1,
      results: [],
      cards: [
        { kind: "plot", id: "a", title: "Plot 1" },
        { kind: "plot", id: "c", title: "Plot 3" },
      ],
    };
    expect(addPlotCard(gapped, 1, () => "new").cards[2]?.title).toBe("Plot 2");
    expect(addPlotCard(base, 1, () => "new").cards[2]?.title).toBe("Plot 3");
    const empty: ResultViewDoc = { version: 1, results: [], cards: [] };
    expect(addPlotCard(empty, -1, () => "new").cards[0]?.title).toBe("Plot 1");
  });

  it("does not mutate the input document", () => {
    addPlotCard(base, 0, () => "new");
    expect(base.cards.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("deleteCard", () => {
  const base: ResultViewDoc = {
    version: 1,
    results: [],
    cards: [
      { kind: "plot", id: "a" },
      { kind: "plot", id: "b" },
    ],
  };

  it("drops the matching card", () => {
    expect(deleteCard(base, "a").cards.map((c) => c.id)).toEqual(["b"]);
  });

  it("is a no-op for an unknown id", () => {
    expect(deleteCard(base, "ghost").cards.map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("addTrace", () => {
  const base: ResultViewDoc = {
    version: 1,
    results: [],
    cards: [
      { kind: "plot", id: "a", traces: [{ result: "r1", variable: "x" }] },
      { kind: "plot", id: "b" },
    ],
  };

  it("appends to the addressed card's traces", () => {
    expect(addTrace(base, "a", "r1", "y").cards[0]?.traces).toEqual([
      { result: "r1", variable: "x" },
      { result: "r1", variable: "y" },
    ]);
  });

  it("seeds traces on a card that had none", () => {
    expect(addTrace(base, "b", "r2", "z").cards[1]?.traces).toEqual([
      { result: "r2", variable: "z" },
    ]);
  });

  it("leaves other cards untouched", () => {
    expect(addTrace(base, "b", "r2", "z").cards[0]?.traces).toEqual([
      { result: "r1", variable: "x" },
    ]);
  });
});

describe("removeTrace", () => {
  const base: ResultViewDoc = {
    version: 1,
    results: [],
    cards: [
      {
        kind: "plot",
        id: "a",
        traces: [
          { result: "r1", variable: "x" },
          { result: "r1", variable: "y" },
        ],
      },
    ],
  };

  it("removes the trace at the given index", () => {
    expect(removeTrace(base, "a", 0).cards[0]?.traces).toEqual([
      { result: "r1", variable: "y" },
    ]);
  });

  it("is a no-op for an out-of-range index", () => {
    expect(removeTrace(base, "a", 9).cards[0]?.traces).toHaveLength(2);
  });
});

describe("addResult", () => {
  const base: ResultViewDoc = {
    version: 1,
    results: [{ id: "r1", label: "run-1", path: "a.mat", source: "simulate" }],
    cards: [{ kind: "plot", id: "c1" }],
  };

  it("appends the result, preserving order", () => {
    const out = addResult(base, {
      id: "r2",
      label: "tank",
      path: "/abs/tank.mat",
      source: "import",
    });
    expect(out.results.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("leaves the cards untouched", () => {
    const out = addResult(base, {
      id: "r2",
      label: "tank",
      path: "tank.mat",
      source: "cache",
    });
    expect(out.cards).toEqual(base.cards);
  });

  it("does not mutate the input document", () => {
    addResult(base, { id: "r2", label: "x", path: "x.mat", source: "import" });
    expect(base.results.map((r) => r.id)).toEqual(["r1"]);
  });
});
