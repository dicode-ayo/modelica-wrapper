/**
 * Tests for `parseVisualXml`. Hand-crafted minimal `_visual.xml` strings —
 * no OMC dependency. The producer is a pure function of XML text.
 *
 * Coverage:
 *  - all-literal shape (a fixed box at the origin)
 *  - shape with a cref in one slot
 *  - shape with a nested <binary> and a <call>cos</call>
 *  - empty <visualization/> root
 *  - malformed input rejection
 */

import { describe, expect, it } from "vitest";

import { parseVisualXml } from "./visualXmlParser.js";

// ---------- builders ----------

function lit(n: number): string {
  return `<exp>${n}</exp>`;
}

function vec(x: number, y: number, z: number): string {
  return `${lit(x)}${lit(y)}${lit(z)}`;
}

/** Identity 3x3 in row-major form, nine <exp> children. */
const IDENTITY_T = [
  lit(1), lit(0), lit(0),
  lit(0), lit(1), lit(0),
  lit(0), lit(0), lit(1),
].join("");

function wrap(shapes: string[]): string {
  return `<?xml version="1.0"?><visualization>${shapes.join("")}</visualization>`;
}

const LITERAL_BOX = `
  <shape>
    <ident>box1.shape_1</ident>
    <type>box</type>
    <T>${IDENTITY_T}</T>
    <r>${vec(0, 0, 0)}</r>
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

const CREF_BOX = `
  <shape>
    <ident>body1.shape_1</ident>
    <type>cylinder</type>
    <T>${IDENTITY_T}</T>
    <r><exp>body1.frame_a.r_0[1]</exp><exp>0</exp><exp>0</exp></r>
    <r_shape>${vec(0, 0, 0)}</r_shape>
    <lengthDir>${vec(1, 0, 0)}</lengthDir>
    <widthDir>${vec(0, 1, 0)}</widthDir>
    <length>${lit(0.5)}</length>
    <width>${lit(0.05)}</width>
    <height>${lit(0.05)}</height>
    <extra>${lit(0)}</extra>
    <color>${vec(0, 255, 0)}</color>
    <specCoeff>${lit(0.7)}</specCoeff>
  </shape>`;

const COMPOUND_EXPR_BOX = `
  <shape>
    <ident>revolute1.shape_1</ident>
    <type>cylinder</type>
    <T>${IDENTITY_T}</T>
    <r>
      <exp><binary><op>+</op><lhs>1.0</lhs><rhs><call><fn>cos</fn><arg>revolute1.phi</arg></call></rhs></binary></exp>
      <exp>0</exp>
      <exp>0</exp>
    </r>
    <r_shape>${vec(0, 0, 0)}</r_shape>
    <lengthDir>${vec(1, 0, 0)}</lengthDir>
    <widthDir>${vec(0, 1, 0)}</widthDir>
    <length>${lit(0.5)}</length>
    <width>${lit(0.05)}</width>
    <height>${lit(0.05)}</height>
    <extra>${lit(0)}</extra>
    <color>${vec(0, 0, 255)}</color>
    <specCoeff>${lit(0.7)}</specCoeff>
  </shape>`;

// =====================================================================
// Tests
// =====================================================================

describe("parseVisualXml: literal-only shape", () => {
  it("decodes every slot as a numeric literal", () => {
    const doc = parseVisualXml(wrap([LITERAL_BOX]));
    expect(doc.shapes).toHaveLength(1);
    const shape = doc.shapes[0]!;
    expect(shape.ident).toBe("box1.shape_1");
    expect(shape.shapeType).toBe("box");
    expect(shape.length).toEqual({ kind: "lit", value: 0.5 });
    expect(shape.width).toEqual({ kind: "lit", value: 0.2 });
    expect(shape.r[0]).toEqual({ kind: "lit", value: 0 });
    expect(shape.T[0][0]).toEqual({ kind: "lit", value: 1 });
    expect(shape.T[1][1]).toEqual({ kind: "lit", value: 1 });
    expect(shape.T[2][2]).toEqual({ kind: "lit", value: 1 });
    expect(shape.color).toEqual([
      { kind: "lit", value: 255 },
      { kind: "lit", value: 0 },
      { kind: "lit", value: 0 },
    ]);
  });
});

describe("parseVisualXml: shape with a cref slot", () => {
  it("captures non-numeric <exp> text as a cref node", () => {
    const doc = parseVisualXml(wrap([CREF_BOX]));
    expect(doc.shapes).toHaveLength(1);
    const shape = doc.shapes[0]!;
    expect(shape.r[0]).toEqual({
      kind: "cref",
      name: "body1.frame_a.r_0[1]",
    });
    expect(shape.r[1]).toEqual({ kind: "lit", value: 0 });
  });
});

describe("parseVisualXml: nested binary + call expression", () => {
  it("walks <binary><op>+</op><lhs>…</lhs><rhs><call>…</call></rhs></binary>", () => {
    const doc = parseVisualXml(wrap([COMPOUND_EXPR_BOX]));
    expect(doc.shapes).toHaveLength(1);
    const shape = doc.shapes[0]!;
    const rx = shape.r[0];
    expect(rx.kind).toBe("binary");
    if (rx.kind !== "binary") return;
    expect(rx.op).toBe("+");
    expect(rx.lhs).toEqual({ kind: "lit", value: 1.0 });
    expect(rx.rhs.kind).toBe("call");
    if (rx.rhs.kind !== "call") return;
    expect(rx.rhs.fn).toBe("cos");
    expect(rx.rhs.args).toHaveLength(1);
    expect(rx.rhs.args[0]).toEqual({
      kind: "cref",
      name: "revolute1.phi",
    });
  });
});

describe("parseVisualXml: multiple shapes round-trip", () => {
  it("returns each shape in source order", () => {
    const doc = parseVisualXml(wrap([LITERAL_BOX, CREF_BOX]));
    expect(doc.shapes).toHaveLength(2);
    expect(doc.shapes[0]?.ident).toBe("box1.shape_1");
    expect(doc.shapes[1]?.ident).toBe("body1.shape_1");
  });
});

describe("parseVisualXml: empty visualization root", () => {
  it("yields three empty arrays, not a parse error", () => {
    const doc = parseVisualXml(
      `<?xml version="1.0"?><visualization></visualization>`,
    );
    expect(doc.shapes).toEqual([]);
    expect(doc.vectors).toEqual([]);
    expect(doc.surfaces).toEqual([]);
  });
});

describe("parseVisualXml: rejects malformed input", () => {
  it("throws on missing <visualization> root", () => {
    expect(() =>
      parseVisualXml(`<?xml version="1.0"?><nope/>`),
    ).toThrow(/missing <visualization>/);
  });

  it("throws on a shape whose <r> has the wrong arity", () => {
    const bad = `
      <shape>
        <ident>x</ident>
        <type>box</type>
        <T>${IDENTITY_T}</T>
        <r>${lit(0)}${lit(0)}</r>
        <r_shape>${vec(0, 0, 0)}</r_shape>
        <lengthDir>${vec(1, 0, 0)}</lengthDir>
        <widthDir>${vec(0, 1, 0)}</widthDir>
        <length>${lit(1)}</length>
        <width>${lit(1)}</width>
        <height>${lit(1)}</height>
        <extra>${lit(0)}</extra>
        <color>${vec(0, 0, 0)}</color>
        <specCoeff>${lit(0)}</specCoeff>
      </shape>`;
    expect(() => parseVisualXml(wrap([bad]))).toThrow(
      /expected 3 <exp> children/,
    );
  });

  it("throws on an unsupported binary op", () => {
    const bad = `
      <shape>
        <ident>x</ident>
        <type>box</type>
        <T>${IDENTITY_T}</T>
        <r>
          <exp><binary><op>^</op><lhs>1</lhs><rhs>2</rhs></binary></exp>
          ${lit(0)}${lit(0)}
        </r>
        <r_shape>${vec(0, 0, 0)}</r_shape>
        <lengthDir>${vec(1, 0, 0)}</lengthDir>
        <widthDir>${vec(0, 1, 0)}</widthDir>
        <length>${lit(1)}</length>
        <width>${lit(1)}</width>
        <height>${lit(1)}</height>
        <extra>${lit(0)}</extra>
        <color>${vec(0, 0, 0)}</color>
        <specCoeff>${lit(0)}</specCoeff>
      </shape>`;
    expect(() => parseVisualXml(wrap([bad]))).toThrow(/unsupported op/);
  });
});
