import { describe, expect, it } from "vitest";
import { Container, Graphics } from "pixi.js";
import type { Color } from "@dicode/omc-client";
import type { Arrowhead } from "@dicode/diagram-svg";

import { buildArrowhead } from "../src/primitives/arrow-utils.js";

const BLACK: Color = [0, 0, 0];

/** A rightward head, as `lineArrowheads` resolves one. Geometry is pinned by
 *  `diagram-svg/src/arrowhead.test.ts`; these cases are the Pixi side. */
const HEAD: Arrowhead = {
  kind: "Filled",
  end: "end",
  tip: [10, 0],
  direction: [1, 0],
  size: 3,
};

/** Read the style of a Graphics' first fill/stroke instruction. */
interface DrawStyle {
  color: number;
  width?: number;
}
function styleOf(g: Graphics, action: "fill" | "stroke"): DrawStyle | null {
  const ins = (
    g.context.instructions as ReadonlyArray<{
      action: string;
      data: { style: DrawStyle };
    }>
  ).find((i) => i.action === action);
  return ins?.data.style ?? null;
}

function makeParent(): Container {
  return new Container({ label: "parent" });
}

function graphicIn(parent: Container, label: string): Graphics {
  const g = parent.getChildByLabel(label, true);
  if (!(g instanceof Graphics)) throw new Error("expected the arrow graphic");
  return g;
}

describe("buildArrowhead", () => {
  it("builds a non-pickable Filled triangle, filled in the arrow colour", () => {
    const parent = makeParent();
    const res = buildArrowhead(parent, HEAD, [255, 0, 0], 0, "filled", 1);
    const g = graphicIn(parent, "filled");
    expect(g.eventMode).toBe("none");
    expect(styleOf(g, "fill")?.color).toBe(0xff0000);
    // A solid triangle has no outline, so the stroke width never reaches it.
    expect(styleOf(g, "stroke")).toBeNull();
    expect(() => res.dispose()).not.toThrow();
  });

  it("strokes an Open chevron and a Half wing at the given strokeWidth", () => {
    const parent = makeParent();
    buildArrowhead(
      parent,
      { ...HEAD, kind: "Open" },
      [0, 255, 0],
      0,
      "open",
      2.5,
    );
    buildArrowhead(
      parent,
      { ...HEAD, kind: "Half" },
      [0, 0, 255],
      0,
      "half",
      1.5,
    );
    expect(styleOf(graphicIn(parent, "open"), "stroke")).toMatchObject({
      color: 0x00ff00,
      width: 2.5,
    });
    expect(styleOf(graphicIn(parent, "half"), "stroke")).toMatchObject({
      color: 0x0000ff,
      width: 1.5,
    });
  });

  it("dispose removes the arrow graphic from its parent", () => {
    const parent = makeParent();
    const res = buildArrowhead(parent, HEAD, BLACK, 0, "disposable", 1);
    expect(parent.getChildByLabel("disposable", true)).not.toBeNull();
    res.dispose();
    expect(parent.getChildByLabel("disposable", true)).toBeNull();
  });
});
