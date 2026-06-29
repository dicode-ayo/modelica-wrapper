/**
 * Headless coverage for the gradient / hatch fill path. happy-dom has no
 * canvas 2D context, so the baked `Texture` can't be exercised here (it's
 * covered visually by the Storybook/Chromatic stories). These tests pin the
 * parts that survive renderer-less:
 *  - solid / none specs never take the texture path,
 *  - a gradient / hatch fill collapses to one cache key (or per-aspect for a
 *    hatch),
 *  - the flat-fill fallback colour: a gradient degrades to its representative
 *    fill colour, a hatch to its background — never to a black/line edge.
 *
 * Pixi `Graphics` fills triangulate internally and map a texture via a
 * matrix/textureSpace, so there are no per-vertex UV buffers to assert
 * (the Babylon `getVerticesData(UVKind)` checks have no Pixi analogue).
 */
import { describe, expect, it } from "vitest";
import { Container, Graphics } from "pixi.js";
import { fillSpec } from "@dicode/diagram-svg";

import {
  buildFilledEllipse,
  buildFilledPolygon,
  buildFilledRect,
  type RectBox,
} from "../src/primitives/shape-utils.js";
import {
  fillCacheKey,
  resolveFillTexture,
} from "../src/primitives/fill-texture.js";

const FILL: [number, number, number] = [192, 192, 192];
const LINE: [number, number, number] = [64, 64, 64];
const BOX: RectBox = { x: -10, y: -5, width: 20, height: 10 };

const cylinder = fillSpec({
  fillColor: FILL,
  lineColor: LINE,
  pattern: "HorizontalCylinder",
});
const hatch = fillSpec({
  fillColor: FILL,
  lineColor: LINE,
  pattern: "Forward",
});
const solid = fillSpec({ fillColor: FILL, lineColor: LINE, pattern: "Solid" });

/** Red channel of a Graphics' flat fill colour. */
function fillRed(g: Graphics): number {
  const ins = (
    g.context.instructions as ReadonlyArray<{
      action: string;
      data: { style: { color: number } };
    }>
  ).find((i) => i.action === "fill");
  if (!ins) throw new Error("expected a fill instruction");
  return (ins.data.style.color >> 16) & 0xff;
}

describe("resolveFillTexture", () => {
  it("returns null for solid and none specs", () => {
    expect(resolveFillTexture(null, solid, 2)).toBeNull();
    expect(resolveFillTexture(null, { kind: "none" }, 2)).toBeNull();
  });
});

describe("fillCacheKey", () => {
  it("collapses a gradient to one key across aspects", () => {
    if (cylinder.kind === "solid" || cylinder.kind === "none") {
      throw new Error("expected a gradient spec");
    }
    expect(fillCacheKey(cylinder, 2)).toBe(fillCacheKey(cylinder, 0.5));
  });

  it("keys a hatch per aspect so its tile is not reused", () => {
    if (hatch.kind === "solid" || hatch.kind === "none") {
      throw new Error("expected a hatch spec");
    }
    expect(fillCacheKey(hatch, 2)).not.toBe(fillCacheKey(hatch, 0.5));
  });
});

describe("buildFilledRect", () => {
  it("falls back to the gradient's fill colour when no texture bakes", () => {
    const parent = new Container();
    const res = buildFilledRect(null, parent, BOX, 0, cylinder, 0, "quad-grad");
    const g = parent.getChildByLabel("quad-grad", true);
    if (!(g instanceof Graphics)) throw new Error("expected the fill graphic");
    // No canvas 2D context → flat fallback, degrading to fill (192), never
    // to the black/line edge.
    expect(fillRed(g)).toBe(192);
    res.dispose();
  });

  it("hatch falls back to its background colour", () => {
    const parent = new Container();
    const res = buildFilledRect(null, parent, BOX, 0, hatch, 0, "quad-hatch");
    const g = parent.getChildByLabel("quad-hatch", true);
    if (!(g instanceof Graphics)) throw new Error("expected the fill graphic");
    expect(fillRed(g)).toBe(192);
    res.dispose();
  });
});

describe("buildFilledEllipse", () => {
  it("falls back to the gradient's fill colour", () => {
    const parent = new Container();
    const res = buildFilledEllipse(
      null,
      parent,
      0,
      0,
      10,
      5,
      BOX,
      cylinder,
      0,
      "fan",
    );
    const g = parent.getChildByLabel("fan", true);
    if (!(g instanceof Graphics)) throw new Error("expected the fill graphic");
    expect(fillRed(g)).toBe(192);
    res.dispose();
  });
});

describe("buildFilledPolygon", () => {
  it("builds a flat fallback fill from the point list (null for < 3 points)", () => {
    const parent = new Container();
    const points: Array<[number, number]> = [
      [-10, -5],
      [10, -5],
      [0, 5],
    ];
    const res = buildFilledPolygon(null, parent, points, hatch, 0, "poly");
    if (!res) throw new Error("polygon fill should build");
    const g = parent.getChildByLabel("poly", true);
    if (!(g instanceof Graphics)) throw new Error("expected the fill graphic");
    expect(fillRed(g)).toBe(192);
    res.dispose();

    expect(
      buildFilledPolygon(null, parent, [[0, 0]], hatch, 0, "degenerate"),
    ).toBeNull();
  });
});
