import { describe, expect, it } from "vitest";

import { ExtentDrawMode } from "../src/interaction/extent-draw-mode.js";
import type {
  DragEvents,
  GestureStart,
} from "../src/interaction/gesture-mode.js";
import type { ExtentKind } from "../src/interaction/tools.js";

function emptyStart(point: { x: number; y: number }): GestureStart {
  return {
    node: null,
    entity: null,
    point,
    shiftKey: false,
    getSelectionKeys: () => [],
  };
}

function setup(kind: ExtentKind | null): {
  mode: ExtentDrawMode;
  shapes: DragEvents["drawShape"][];
} {
  const shapes: DragEvents["drawShape"][] = [];
  const mode = new ExtentDrawMode(
    (type, detail) => {
      if (type === "drawShape") shapes.push(detail as DragEvents["drawShape"]);
    },
    () => kind,
  );
  return { mode, shapes };
}

describe("ExtentDrawMode", () => {
  it("does not begin when the select tool is armed (no draw kind)", () => {
    const { mode, shapes } = setup(null);
    expect(mode.begin(emptyStart({ x: 0, y: 0 }))).toBe(false);
    expect(shapes).toHaveLength(0);
  });

  it("emits a normalized draft on move and a committed extent on release", () => {
    const { mode, shapes } = setup("rectangle");
    expect(mode.begin(emptyStart({ x: 10, y: 60 }))).toBe(true);
    // Drag up-and-right — corners come back ordered min→max.
    mode.update({ x: 40, y: 20 });
    mode.commit({ x: 40, y: 20 });

    expect(shapes).toEqual([
      {
        kind: "rectangle",
        extent: [
          [10, 20],
          [40, 60],
        ],
        draft: true,
      },
      {
        kind: "rectangle",
        extent: [
          [10, 20],
          [40, 60],
        ],
        draft: false,
      },
    ]);
  });

  it("sends extent:null on a degenerate release so no zero-size shape lands", () => {
    const { mode, shapes } = setup("ellipse");
    expect(mode.begin(emptyStart({ x: 5, y: 5 }))).toBe(true);
    mode.commit({ x: 5, y: 5 }); // a click, never dragged

    expect(shapes).toEqual([{ kind: "ellipse", extent: null, draft: false }]);
  });

  it("carries the armed kind through the gesture", () => {
    const { mode, shapes } = setup("ellipse");
    mode.begin(emptyStart({ x: 0, y: 0 }));
    mode.update({ x: 30, y: 30 });
    expect(shapes.at(0)?.kind).toBe("ellipse");
  });
});
