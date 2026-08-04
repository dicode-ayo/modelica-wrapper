import { describe, expect, it } from "vitest";
import type { DiagramLayout, Shape } from "@dicode/omc-client";

import { emptyLayout, mountLayout } from "./harness/interaction-fixtures.js";

/**
 * Drawing a shape selects it (#385). The host then answers the write with the
 * class as OMC holds it — which materialises every default the drawn shape
 * omitted (`pattern`, `lineThickness`, an ellipse's `closure`) — and that
 * arrives as an external `layout` swap, where `retainExistingSelection` decides
 * what survives. A shape key is positional, so the question is whether the key
 * just handed to the user still resolves once the canonical layout lands.
 */

const DRAWN: Shape = {
  kind: "rectangle",
  extent: [
    [0, 0],
    [10, 10],
  ],
  lineColor: [0, 0, 0],
} as unknown as Shape;

/** The same shape as OMC returns it: identical geometry, defaults filled in. */
const CANONICAL: Shape = {
  ...DRAWN,
  pattern: "Solid",
  fillPattern: "None",
  lineThickness: 0.25,
} as unknown as Shape;

function withOwnShapes(shapes: Shape[]): DiagramLayout {
  return {
    ...emptyLayout(),
    className: "Demo",
    diagramLayers: [{ from: "Demo", shapes }],
  } as unknown as DiagramLayout;
}

describe("a drawn shape's selection across the settle", () => {
  it("survives the canonical layout arriving with defaults filled in", async () => {
    const el = await mountLayout({
      picker: () => null,
      layout: withOwnShapes([DRAWN]),
    });
    el.setSelection(["shape:rectangle:0"]);
    expect(el.selection).toEqual(["shape:rectangle:0"]);

    el.layout = withOwnShapes([CANONICAL]);
    await el.updateComplete;

    expect(el.selection).toEqual(["shape:rectangle:0"]);
  });

  it("survives when the write created the class's own layer", async () => {
    // A class with no own graphics has no layer until the first draw, so the
    // canonical re-read is the first layout that carries one at all.
    const el = await mountLayout({
      picker: () => null,
      layout: { ...emptyLayout(), className: "Demo" } as DiagramLayout,
    });
    el.layout = withOwnShapes([DRAWN]);
    await el.updateComplete;
    el.setSelection(["shape:rectangle:0"]);

    el.layout = withOwnShapes([CANONICAL]);
    await el.updateComplete;

    expect(el.selection).toEqual(["shape:rectangle:0"]);
  });

  it("drops the selection when the shape at that index is no longer the same kind", async () => {
    const el = await mountLayout({
      picker: () => null,
      layout: withOwnShapes([DRAWN]),
    });
    el.setSelection(["shape:rectangle:0"]);

    el.layout = withOwnShapes([
      { ...DRAWN, kind: "ellipse" } as unknown as Shape,
    ]);
    await el.updateComplete;

    expect(el.selection).toEqual([]);
  });
});
