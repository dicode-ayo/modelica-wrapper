/**
 * Decoder tests for per-shape GraphicItem fields (issue #76, item 15).
 *
 * Every §18.6 graphic starts with `[visible, origin, rotation]`. The decoder
 * now surfaces non-default values on the typed shape so renderers can apply
 * each shape's own transform / visibility independently of the placement.
 */

import { describe, expect, it } from "vitest";

import type { RecordValue } from "../../_shared/modelInstance.js";
import { decodeShape } from "./shapes.js";

const SOLID_LINE = { $kind: "enum", name: "LinePattern.Solid", index: 1 };
const SOLID_FILL = { $kind: "enum", name: "FillPattern.Solid", index: 1 };
const NO_BORDER = { $kind: "enum", name: "BorderPattern.None", index: 1 };
const NO_ARROW = { $kind: "enum", name: "Arrow.None", index: 1 };
const NO_SMOOTH = { $kind: "enum", name: "Smooth.None", index: 1 };

/** Rectangle record with a configurable GraphicItem prefix. */
function rect(
  visible: boolean,
  origin: [number, number],
  rotation: number,
): RecordValue {
  return {
    $kind: "record",
    name: "Rectangle",
    elements: [
      visible,
      origin,
      rotation,
      [0, 0, 0],
      [255, 255, 255],
      SOLID_LINE,
      SOLID_FILL,
      1,
      NO_BORDER,
      [
        [-10, -10],
        [10, 10],
      ],
      0,
    ],
  } as unknown as RecordValue;
}

describe("decodeShape: GraphicItem visible/origin/rotation (issue #76, item 15)", () => {
  it("omits all three when they are at their Modelica defaults", () => {
    const s = decodeShape(rect(true, [0, 0], 0));
    expect(s.kind).toBe("rectangle");
    expect("visible" in s).toBe(false);
    expect("origin" in s).toBe(false);
    expect("rotation" in s).toBe(false);
  });

  it("surfaces visible=false", () => {
    const s = decodeShape(rect(false, [0, 0], 0));
    expect(s.visible).toBe(false);
  });

  it("surfaces a non-zero origin", () => {
    const s = decodeShape(rect(true, [5, -7], 0));
    expect(s.origin).toEqual([5, -7]);
  });

  it("surfaces a non-zero rotation", () => {
    const s = decodeShape(rect(true, [0, 0], 90));
    expect(s.rotation).toBe(90);
  });

  it("surfaces all three together", () => {
    const s = decodeShape(rect(false, [1, 2], 45));
    expect(s.visible).toBe(false);
    expect(s.origin).toEqual([1, 2]);
    expect(s.rotation).toBe(45);
  });

  it("applies the same prefix decoding to a Line shape", () => {
    const line: RecordValue = {
      $kind: "record",
      name: "Line",
      elements: [
        true,
        [3, 4],
        30,
        [
          [0, 0],
          [10, 10],
        ],
        [0, 0, 0],
        SOLID_LINE,
        0.5,
        [NO_ARROW, NO_ARROW],
        3,
        NO_SMOOTH,
      ],
    } as unknown as RecordValue;
    const s = decodeShape(line);
    expect(s.kind).toBe("line");
    expect(s.origin).toEqual([3, 4]);
    expect(s.rotation).toBe(30);
  });
});
