/**
 * `Smooth.Bezier` reaches the Pixi renderer: `<om-line>` and `<om-polygon>`
 * stroke the flattened curve rather than the raw control polygon, so an
 * interior vertex becomes a rounded corner the path never touches — and the
 * follow-the-line hit tube tracks the curve, since its 1.5-unit radius is far
 * narrower than the gap a smoothed vertex opens. The geometry itself is
 * pinned in `@dicode/diagram-svg`; these pin the wiring.
 */
import { describe, expect, it } from "vitest";
import type { DiagramLayout, Point } from "@dicode/omc-client";

import { applyShapeSmoothToggle } from "../src/interaction/layout-ops.js";
import {
  graphicsWithLabel,
  mountLayout,
} from "./harness/interaction-fixtures.js";
import { withOwnShape } from "./harness/layout-fixtures.js";
import { pathVertices } from "./pixi-dash.helper.js";

const APEX: Point = [0, 50];

function arc(smooth: string | undefined): DiagramLayout {
  return withOwnShape({
    kind: "line",
    points: [[-50, 0], APEX, [50, 0]],
    color: [255, 0, 0],
    thickness: 2,
    ...(smooth !== undefined ? { smooth } : {}),
  });
}

function triangle(smooth: string | undefined): DiagramLayout {
  return withOwnShape({
    kind: "polygon",
    points: [[-50, -50], [50, -50], APEX, [-50, -50]],
    lineColor: [255, 0, 0],
    fillPattern: "None",
    lineThickness: 2,
    ...(smooth !== undefined ? { smooth } : {}),
  });
}

function contains(
  vertices: ReadonlyArray<readonly [number, number]>,
  target: readonly [number, number],
): boolean {
  return vertices.some(([x, y]) => x === target[0] && y === target[1]);
}

describe.each([
  { kind: "line", build: arc, label: "om-line.0", hit: "hit.om-shape:line:0" },
  {
    kind: "polygon",
    build: triangle,
    label: "om-polygon.0.stroke",
    hit: "hit.om-shape:polygon:0",
  },
])("$kind Smooth.Bezier", ({ build, label, hit }) => {
  it("strokes the control polygon verbatim without smoothing", async () => {
    const el = await mountLayout({ layout: build(undefined) });
    expect(contains(pathVertices(graphicsWithLabel(el, label)), APEX)).toBe(
      true,
    );
  });

  it("rounds the apex away and stays inside the control hull", async () => {
    const el = await mountLayout({ layout: build("Bezier") });
    const vertices = pathVertices(graphicsWithLabel(el, label));
    expect(contains(vertices, APEX)).toBe(false);
    expect(vertices.length).toBeGreaterThan(8);
    for (const [x, y] of vertices) {
      expect(Math.abs(x)).toBeLessThanOrEqual(50);
      expect(y).toBeLessThanOrEqual(50);
    }
  });

  it("runs the hit tube along the curve rather than the control polygon", async () => {
    const el = await mountLayout({ layout: build("Bezier") });
    expect(pathVertices(graphicsWithLabel(el, hit))).toEqual(
      pathVertices(graphicsWithLabel(el, label)),
    );
  });
});

describe("toggling smooth on a live shape", () => {
  it("re-traces the hit tube, not just the paint", async () => {
    // `applyShapeSmoothToggle` spreads the shape, so the toggled layout
    // carries the very same `points` array — the tube must still rebuild.
    const straight = arc(undefined);
    const el = await mountLayout({ layout: straight });
    const tube = "hit.om-shape:line:0";
    expect(contains(pathVertices(graphicsWithLabel(el, tube)), APEX)).toBe(
      true,
    );

    el.layout = applyShapeSmoothToggle(straight, "shape:line:0");
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));

    const after = pathVertices(graphicsWithLabel(el, tube));
    expect(contains(after, APEX)).toBe(false);
    expect(after).toEqual(pathVertices(graphicsWithLabel(el, "om-line.0")));
  });
});

describe("two-point Smooth.Bezier line", () => {
  it("stays a straight segment between its endpoints", async () => {
    const el = await mountLayout({
      layout: withOwnShape({
        kind: "line",
        points: [
          [-50, 0],
          [50, 0],
        ],
        color: [255, 0, 0],
        thickness: 2,
        smooth: "Bezier",
      }),
    });
    expect(pathVertices(graphicsWithLabel(el, "om-line.0"))).toEqual([
      [-50, 0],
      [50, 0],
    ]);
  });
});
