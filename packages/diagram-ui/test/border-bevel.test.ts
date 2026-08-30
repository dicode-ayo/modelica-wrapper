/**
 * `Rectangle.borderPattern` rendering: the annotation asks for a shaded
 * bevel, not an outline, so a Raised/Sunken/Engraved rectangle must draw
 * the two-tone edge frame INSTEAD of the solid `lineColor` stroke — a
 * heavy solid border is exactly what OMEdit does not show for e.g.
 * `Modelica.Blocks.Interaction.Show.RealValue`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Container, Graphics } from "pixi.js";
import type { Color, RectangleShape } from "@dicode/omc-client";
import { bevelColors, bevelEdges } from "@dicode/diagram-svg";

import { OmRectangle } from "../src/primitives/rectangle.component.js";
import { packColor } from "../src/primitives/shape-utils.js";

class TestRectangle extends OmRectangle {
  buildMeshesAt(parent: Container, z: number): void {
    this.buildMeshes(parent, z);
  }
}

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) t();
});

const FACE: Color = [236, 233, 216];

function buildRect(parent: Container, borderPattern?: string): TestRectangle {
  const el = new TestRectangle();
  el.shape = {
    kind: "rectangle",
    extent: [
      [-100, -100],
      [100, 100],
    ],
    lineColor: [0, 0, 127],
    fillColor: FACE,
    fillPattern: "Solid",
    pattern: "Solid",
    ...(borderPattern !== undefined ? { borderPattern } : {}),
  } satisfies RectangleShape;
  el.buildMeshesAt(parent, 0);
  teardowns.push(() => el.disconnectedCallback());
  return el;
}

function graphic(parent: Container, label: string): Graphics | null {
  const g = parent.getChildByLabel(label, true);
  return g instanceof Graphics ? g : null;
}

function strokeColorOf(g: Graphics): number | undefined {
  const ins = (
    g.context.instructions as ReadonlyArray<{
      action: string;
      data: { style: { color: number } };
    }>
  ).find((i) => i.action === "stroke");
  return ins?.data.style.color;
}

const STROKE = "om-rectangle.0.stroke";
const BEVEL_TOP = "om-rectangle.0.bevel-top";
const BEVEL_BOTTOM = "om-rectangle.0.bevel-bottom";

describe("<om-rectangle> borderPattern", () => {
  it("Raised replaces the solid outline with a light-top / dark-bottom bevel", () => {
    const parent = new Container();
    buildRect(parent, "Raised");
    expect(graphic(parent, STROKE)).toBeNull();
    const top = graphic(parent, BEVEL_TOP);
    const bottom = graphic(parent, BEVEL_BOTTOM);
    if (!top || !bottom) throw new Error("expected both bevel strokes");
    const { light, dark } = bevelColors(FACE);
    expect(strokeColorOf(top)).toBe(packColor(light));
    expect(strokeColorOf(bottom)).toBe(packColor(dark));
  });

  it("Sunken inverts the bevel tones", () => {
    const parent = new Container();
    buildRect(parent, "Sunken");
    const top = graphic(parent, BEVEL_TOP);
    const bottom = graphic(parent, BEVEL_BOTTOM);
    if (!top || !bottom) throw new Error("expected both bevel strokes");
    const { light, dark } = bevelColors(FACE);
    expect(strokeColorOf(top)).toBe(packColor(dark));
    expect(strokeColorOf(bottom)).toBe(packColor(light));
  });

  it("Engraved renders with the sunken tones", () => {
    const parent = new Container();
    buildRect(parent, "Engraved");
    const top = graphic(parent, BEVEL_TOP);
    if (!top) throw new Error("expected the bevel");
    expect(strokeColorOf(top)).toBe(packColor(bevelColors(FACE).dark));
    expect(graphic(parent, STROKE)).toBeNull();
  });

  it("None and absent borderPattern keep the plain outline and no bevel", () => {
    for (const bp of [undefined, "None"]) {
      const parent = new Container();
      buildRect(parent, bp);
      expect(graphic(parent, STROKE)).not.toBeNull();
      expect(graphic(parent, BEVEL_TOP)).toBeNull();
      expect(graphic(parent, BEVEL_BOTTOM)).toBeNull();
    }
  });
});

describe("bevelEdges", () => {
  const BOX = { x: -10, y: -5, width: 20, height: 10 };

  it("decides Engraved once, as the sunken tones", () => {
    const engraved = bevelEdges(BOX, "Engraved", FACE);
    const sunken = bevelEdges(BOX, "Sunken", FACE);
    expect(engraved).toEqual(sunken);
    if (!engraved) throw new Error("expected a bevel");
    expect(engraved.topLeft.color).toEqual(bevelColors(FACE).dark);
  });

  it("draws no bevel for None or an absent pattern", () => {
    expect(bevelEdges(BOX, "None", FACE)).toBeNull();
    expect(bevelEdges(BOX, undefined, FACE)).toBeNull();
  });
});

describe("bevelColors", () => {
  it("derives Qt's lighter(150)/darker(200) tones from the face color", () => {
    // HSV Value overflows full brightness here, so the excess desaturates —
    // green stays pinned at 255 while the other channels move toward white.
    expect(bevelColors([100, 200, 40])).toEqual({
      light: [156, 255, 96],
      dark: [50, 100, 20],
    });
  });

  it("lightens a fully saturated primary toward white, not onto itself", () => {
    // A per-channel multiply saturates red back to [255,0,0] — an invisible
    // light edge. Qt's Value-overflow-into-Saturation rule yields pink.
    expect(bevelColors([255, 0, 0]).light).toEqual([255, 128, 128]);
  });

  it("matches the plain per-channel multiply while Value stays in range", () => {
    expect(bevelColors([100, 160, 40]).light).toEqual([150, 240, 60]);
  });

  it("keeps a black face black on both edges (Qt does too)", () => {
    expect(bevelColors([0, 0, 0])).toEqual({
      light: [0, 0, 0],
      dark: [0, 0, 0],
    });
  });
});
