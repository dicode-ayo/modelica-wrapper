/**
 * `startAngle` / `endAngle` / `closure` reach the Pixi renderer: `<om-ellipse>`
 * strokes the swept outline rather than the bounding ring, closes it the way
 * the closure says, and drops the fill entirely for `EllipseClosure.None`. The
 * geometry itself is pinned in `@dicode/diagram-svg`; these pin the wiring.
 */
import { describe, expect, it } from "vitest";
import type { DiagramLayout, EllipseShape } from "@dicode/omc-client";

import {
  graphicsWithLabel,
  mountLayout,
} from "./harness/interaction-fixtures.js";
import { emptyLayout } from "./harness/layout-fixtures.js";
import { pathInstructions, pathVertices } from "./pixi-dash.helper.js";

const FILL = "om-ellipse.0.fill";
const STROKE = "om-ellipse.0.stroke";

function layout(fields: Partial<EllipseShape>): DiagramLayout {
  const shape: EllipseShape = {
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
  };
  return {
    ...emptyLayout(),
    diagramLayers: [{ from: "Demo", shapes: [shape] }],
  };
}

function fillActions(el: Awaited<ReturnType<typeof mountLayout>>): string[] {
  return pathInstructions(graphicsWithLabel(el, FILL)).map((i) => i.action);
}

describe("om-ellipse arc sweeps", () => {
  it("keeps the dedicated ellipse fill for a full sweep", async () => {
    const el = await mountLayout({ layout: layout({}) });
    expect(fillActions(el)).toContain("ellipse");
  });

  it("fills a partial sweep as the swept polygon instead", async () => {
    const el = await mountLayout({
      layout: layout({ startAngle: 0, endAngle: 90 }),
    });
    expect(fillActions(el)).toContain("poly");
  });

  it("suppresses the fill for EllipseClosure.None despite a fillPattern", async () => {
    const el = await mountLayout({
      layout: layout({ startAngle: 0, endAngle: 90, closure: "None" }),
    });
    expect(() => graphicsWithLabel(el, FILL)).toThrow();
  });

  it("draws the quarter the angles name, not the bounding ring", async () => {
    const el = await mountLayout({
      layout: layout({ startAngle: 0, endAngle: 90, closure: "None" }),
    });
    const vertices = pathVertices(graphicsWithLabel(el, STROKE));
    expect(vertices.length).toBeGreaterThan(8);
    for (const [x, y] of vertices) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("closes a Chord outline and leaves an open arc open", async () => {
    const partial = { startAngle: 0, endAngle: 90 } as const;
    const open = pathVertices(
      graphicsWithLabel(
        await mountLayout({ layout: layout({ ...partial, closure: "None" }) }),
        STROKE,
      ),
    );
    const chord = pathVertices(
      graphicsWithLabel(
        await mountLayout({ layout: layout({ ...partial, closure: "Chord" }) }),
        STROKE,
      ),
    );
    expect(open.at(-1)).not.toEqual(open[0]);
    expect(chord.at(-1)).toEqual(chord[0]);
  });

  it("anchors a Radial slice at the center", async () => {
    const el = await mountLayout({
      layout: layout({ startAngle: 0, endAngle: 90, closure: "Radial" }),
    });
    expect(pathVertices(graphicsWithLabel(el, STROKE))[0]).toEqual([0, 0]);
  });
});
