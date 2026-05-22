import { describe, expect, it } from "vitest";

import {
  CardSchema,
  emptyResultViewDoc,
  ResultRefSchema,
  ResultViewDocSchema,
  type ResultViewDoc,
} from "./resultView.js";

// A fully-populated, schema-valid document.
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

describe("emptyResultViewDoc", () => {
  it("is a schema-valid empty document at version 1", () => {
    const empty = emptyResultViewDoc();
    expect(empty).toEqual({ version: 1, results: [], cards: [] });
    expect(ResultViewDocSchema.safeParse(empty).success).toBe(true);
  });
});

describe("ResultViewDocSchema", () => {
  it("accepts a fully-populated document", () => {
    expect(ResultViewDocSchema.safeParse(FULL_DOC).success).toBe(true);
  });

  it("rejects a non-1 version", () => {
    expect(ResultViewDocSchema.safeParse({ ...FULL_DOC, version: 2 }).success).toBe(false);
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(
      ResultViewDocSchema.safeParse({ ...emptyResultViewDoc(), bogus: true }).success,
    ).toBe(false);
  });
});

describe("ResultRefSchema", () => {
  it("requires id/label/path/source", () => {
    expect(ResultRefSchema.safeParse({ id: "x", label: "x", path: "x.mat" }).success).toBe(false);
  });

  it("accepts null commit/dirty but rejects an unknown source", () => {
    expect(
      ResultRefSchema.safeParse({ id: "x", label: "x", path: "x.mat", source: "import", commit: null, dirty: null }).success,
    ).toBe(true);
    expect(
      ResultRefSchema.safeParse({ id: "x", label: "x", path: "x.mat", source: "nope" }).success,
    ).toBe(false);
  });

  it("rejects unknown extra keys (strict)", () => {
    expect(
      ResultRefSchema.safeParse({ id: "x", label: "x", path: "x.mat", source: "import", extra: 1 }).success,
    ).toBe(false);
  });
});

describe("CardSchema", () => {
  it("requires kind: 'plot'", () => {
    expect(CardSchema.safeParse({ title: "no kind" }).success).toBe(false);
    expect(CardSchema.safeParse({ kind: "plot", title: "ok" }).success).toBe(true);
  });

  it("rejects an unknown card kind", () => {
    expect(CardSchema.safeParse({ kind: "markdown", template: "x" }).success).toBe(false);
  });
});
