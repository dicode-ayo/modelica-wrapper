/**
 * Tests for the expression resolver and scene producer. Each block
 * hand-builds the smallest input that exercises the behavior under
 * test — no fixture files.
 *
 * Coverage matrix (per the design doc's "Producer responsibilities"):
 *  - literal-only shape: resolver substitutes nothing; result is fully
 *    resolved
 *  - cref-bearing shape, env hit: substitutes correctly
 *  - cref-bearing shape, env miss: shape flagged unresolved, no crash
 *  - nested binary + call: arithmetic + cos/sin/sqrt
 */

import { describe, expect, it } from "vitest";

import {
  produceVisualScene,
  resolveExpressions,
} from "./multibodyScene.js";
import { parseVisualXml } from "./visualXmlParser.js";

// ---------- inline XML builders (mirrored from visualXmlParser.test.ts) ----------

function lit(n: number): string {
  return `<exp>${n}</exp>`;
}
function vec(x: number, y: number, z: number): string {
  return `${lit(x)}${lit(y)}${lit(z)}`;
}
const IDENTITY_T = [
  lit(1), lit(0), lit(0),
  lit(0), lit(1), lit(0),
  lit(0), lit(0), lit(1),
].join("");

function wrap(shapes: string[]): string {
  return `<?xml version="1.0"?><visualization>${shapes.join("")}</visualization>`;
}

function shapeXml(opts: {
  ident: string;
  type?: string;
  rX?: string;
}): string {
  const type = opts.type ?? "box";
  const rX = opts.rX ?? lit(0);
  return `
    <shape>
      <ident>${opts.ident}</ident>
      <type>${type}</type>
      <T>${IDENTITY_T}</T>
      <r>${rX}${lit(0)}${lit(0)}</r>
      <r_shape>${vec(0, 0, 0)}</r_shape>
      <lengthDir>${vec(1, 0, 0)}</lengthDir>
      <widthDir>${vec(0, 1, 0)}</widthDir>
      <length>${lit(0.5)}</length>
      <width>${lit(0.2)}</width>
      <height>${lit(0.1)}</height>
      <extra>${lit(0)}</extra>
      <color>${vec(255, 0, 0)}</color>
      <specCoeff>${lit(0.7)}</specCoeff>
    </shape>`;
}

// =====================================================================
// resolveExpressions
// =====================================================================

describe("resolveExpressions: literal-only shape", () => {
  it("produces fully resolved numeric slots without the unresolved flag", () => {
    const doc = parseVisualXml(wrap([shapeXml({ ident: "box1.shape_1" })]));
    const scene = resolveExpressions(doc, new Map());
    expect(scene.shapes).toHaveLength(1);
    const s = scene.shapes[0]!;
    expect(s.unresolved).toBeUndefined();
    expect(s.r).toEqual([0, 0, 0]);
    expect(s.length).toBe(0.5);
    expect(s.T).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });
});

describe("resolveExpressions: cref resolved against env", () => {
  it("substitutes the env value for a known cref", () => {
    const doc = parseVisualXml(
      wrap([
        shapeXml({ ident: "body1.shape_1", rX: `<exp>body1.r[1]</exp>` }),
      ]),
    );
    const env = new Map([["body1.r[1]", 1.25]]);
    const scene = resolveExpressions(doc, env);
    const s = scene.shapes[0]!;
    expect(s.unresolved).toBeUndefined();
    expect(s.r[0]).toBe(1.25);
  });
});

describe("resolveExpressions: nested binary + call", () => {
  it("evaluates 1 + cos(phi) when phi is in the env", () => {
    const doc = parseVisualXml(
      wrap([
        shapeXml({
          ident: "revolute1.shape_1",
          rX: `<exp><binary><op>+</op><lhs>1.0</lhs><rhs><call><fn>cos</fn><arg>revolute1.phi</arg></call></rhs></binary></exp>`,
        }),
      ]),
    );
    const env = new Map([["revolute1.phi", 0]]);
    const scene = resolveExpressions(doc, env);
    const s = scene.shapes[0]!;
    expect(s.unresolved).toBeUndefined();
    // 1 + cos(0) = 2
    expect(s.r[0]).toBeCloseTo(2, 12);
  });

  it("evaluates sin and sqrt", () => {
    const doc = parseVisualXml(
      wrap([
        shapeXml({
          ident: "x.shape_1",
          rX: `<exp><binary><op>*</op><lhs><call><fn>sin</fn><arg>0</arg></call></lhs><rhs><call><fn>sqrt</fn><arg>4</arg></call></rhs></binary></exp>`,
        }),
      ]),
    );
    const scene = resolveExpressions(doc, new Map());
    // sin(0) * sqrt(4) = 0
    expect(scene.shapes[0]?.r[0]).toBe(0);
  });

  it("evaluates a unary negation", () => {
    const doc = parseVisualXml(
      wrap([
        shapeXml({
          ident: "x.shape_1",
          rX: `<exp><unary><op>-</op><exp>3.5</exp></unary></exp>`,
        }),
      ]),
    );
    const scene = resolveExpressions(doc, new Map());
    expect(scene.shapes[0]?.r[0]).toBe(-3.5);
  });
});

describe("resolveExpressions: missing cref does not crash", () => {
  it("flags unresolved=true and leaves the shape rest intact", () => {
    const doc = parseVisualXml(
      wrap([
        shapeXml({
          ident: "ghost.shape_1",
          rX: `<exp>missing.var</exp>`,
        }),
      ]),
    );
    const scene = resolveExpressions(doc, new Map());
    const s = scene.shapes[0]!;
    expect(s.unresolved).toBe(true);
    // other slots resolved fine
    expect(s.length).toBe(0.5);
    expect(s.color).toEqual([255, 0, 0]);
  });

  it("propagates unresolved through arithmetic", () => {
    const doc = parseVisualXml(
      wrap([
        shapeXml({
          ident: "ghost.shape_1",
          rX: `<exp><binary><op>+</op><lhs>1</lhs><rhs>missing.var</rhs></binary></exp>`,
        }),
      ]),
    );
    const scene = resolveExpressions(doc, new Map());
    expect(scene.shapes[0]?.unresolved).toBe(true);
  });
});

describe("produceVisualScene: combined parse + resolve helper", () => {
  it("matches calling resolveExpressions directly on the parsed doc", () => {
    const xml = wrap([shapeXml({ ident: "box1.shape_1" })]);
    const doc = parseVisualXml(xml);
    const env = new Map<string, number>();
    expect(produceVisualScene(doc, env)).toEqual(
      resolveExpressions(doc, env),
    );
  });
});
