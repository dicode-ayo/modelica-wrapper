import { describe, expect, it } from "vitest";

import {
  BORDER_PATTERNS,
  ELLIPSE_CLOSURES,
  FILL_PATTERNS,
  isBezierSmooth,
  isBorderPattern,
  isEllipseClosure,
  isFillPattern,
  isLinePattern,
  isSmooth,
  isTextAlignment,
  LINE_PATTERNS,
  SMOOTH_VALUES,
  TEXT_ALIGNMENTS,
} from "./defaults.js";

describe("enum vocabularies", () => {
  const vocabularies = [
    ["LinePattern", LINE_PATTERNS, isLinePattern],
    ["FillPattern", FILL_PATTERNS, isFillPattern],
    ["Smooth", SMOOTH_VALUES, isSmooth],
    ["BorderPattern", BORDER_PATTERNS, isBorderPattern],
    ["TextAlignment", TEXT_ALIGNMENTS, isTextAlignment],
    ["EllipseClosure", ELLIPSE_CLOSURES, isEllipseClosure],
  ] as const;

  it.each(vocabularies)(
    "%s guard accepts exactly its members",
    (_, list, guard) => {
      for (const member of list) expect(guard(member)).toBe(true);
      expect(guard(undefined)).toBe(false);
      expect(guard("")).toBe(false);
      expect(guard("solid")).toBe(false);
      expect(guard("NotAMember")).toBe(false);
    },
  );

  it("declares each list in §18.6 order, with no repeats", () => {
    expect(LINE_PATTERNS).toEqual([
      "None",
      "Solid",
      "Dash",
      "Dot",
      "DashDot",
      "DashDotDot",
    ]);
    expect(FILL_PATTERNS).toEqual([
      "None",
      "Solid",
      "Horizontal",
      "Vertical",
      "Cross",
      "Forward",
      "Backward",
      "CrossDiag",
      "HorizontalCylinder",
      "VerticalCylinder",
      "Sphere",
    ]);
    expect(ELLIPSE_CLOSURES).toEqual(["None", "Chord", "Radial"]);
    expect(SMOOTH_VALUES).toEqual(["None", "Bezier"]);
    expect(BORDER_PATTERNS).toEqual(["None", "Raised", "Sunken", "Engraved"]);
    expect(TEXT_ALIGNMENTS).toEqual(["Left", "Center", "Right"]);
    for (const [, list] of vocabularies) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe("isBezierSmooth", () => {
  it("selects only Smooth.Bezier", () => {
    expect(isBezierSmooth("Bezier")).toBe(true);
    expect(isBezierSmooth("None")).toBe(false);
    expect(isBezierSmooth(undefined)).toBe(false);
    expect(isBezierSmooth("bezier")).toBe(false);
  });
});
