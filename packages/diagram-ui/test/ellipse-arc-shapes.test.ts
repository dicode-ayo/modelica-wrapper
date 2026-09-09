/**
 * `startAngle` / `endAngle` / `closure` reach the Pixi renderer: `<om-ellipse>`
 * strokes the swept outline rather than the bounding ring, closes it the way
 * the closure says, and drops the fill entirely for `EllipseClosure.None`. The
 * geometry itself is pinned in `@dicode/diagram-svg`; these pin the wiring.
 */
import { describe, expect, it } from "vitest";
import type { EllipseShape } from "@dicode/omc-client";

import {
  graphicsWithLabel,
  mountLayout,
} from "./harness/interaction-fixtures.js";
import { withOwnShape } from "./harness/layout-fixtures.js";
import { pathInstructions, pathVertices } from "./pixi-dash.helper.js";

const FILL = "om-ellipse.0.fill";
const STROKE = "om-ellipse.0.stroke";

function mount(fields: Partial<EllipseShape>): ReturnType<typeof mountLayout> {
  return mountLayout({
    layout: withOwnShape({
      kind: "ellipse",
      extent: [
        [-50, -50],
        [50, 50],
      ],
      lineColor: [255, 0, 0],
      fillColor: [0, 0, 255],
      fillPattern: "Solid",
      lineThickness: 2,
      ...fields,
    }),
  });
}

describe("om-ellipse arc sweeps", () => {
  it("fills a full sweep from the same sampled ring it strokes", async () => {
    const el = await mount({});
    expect(
      pathInstructions(graphicsWithLabel(el, FILL)).map((i) => i.action),
    ).toContain("poly");
  });

  it.each([
    { closure: "Chord", fillAction: "poly", first: [50, 0] },
    { closure: "Radial", fillAction: "poly", first: [0, 0] },
    { closure: "None", fillAction: undefined, first: [50, 0] },
  ])(
    "fills and closes a $closure quarter the way the closure says",
    async ({ closure, fillAction, first }) => {
      const el = await mount({ startAngle: 0, endAngle: 90, closure });
      if (fillAction === undefined) {
        expect(() => graphicsWithLabel(el, FILL)).toThrow();
      } else {
        expect(
          pathInstructions(graphicsWithLabel(el, FILL)).map((i) => i.action),
        ).toContain(fillAction);
      }
      const vertices = pathVertices(graphicsWithLabel(el, STROKE));
      expect(vertices[0]).toEqual(first);
      expect(vertices.at(-1)?.every((n, i) => n === first[i])).toBe(
        closure !== "None",
      );
      // The named quarter, not the bounding ring: every vertex, the center and
      // the chord included, sits in the first quadrant.
      expect(vertices.length).toBeGreaterThan(8);
      for (const [x, y] of vertices) {
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
      }
    },
  );
});
