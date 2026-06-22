import { describe, expect, it } from "vitest";

import { ExtentToolMode } from "../src/interaction/extent-tool-mode.js";
import type { ToolEvents } from "../src/interaction/tool-mode.js";
import type { ExtentKind } from "../src/interaction/tools.js";

function setup(kind: ExtentKind | null): {
  mode: ExtentToolMode;
  shapes: ToolEvents["drawShape"][];
} {
  const shapes: ToolEvents["drawShape"][] = [];
  const mode = new ExtentToolMode(
    (type, detail) => {
      if (type === "drawShape") shapes.push(detail as ToolEvents["drawShape"]);
    },
    () => kind,
  );
  return { mode, shapes };
}

describe("ExtentToolMode", () => {
  it("is a press-drag tool and inactive before a press", () => {
    const { mode } = setup("rectangle");
    expect(mode.pressDrag).toBe(true);
    expect(mode.active).toBe(false);
  });

  it("does nothing when the select tool is armed (no kind)", () => {
    const { mode, shapes } = setup(null);
    mode.press({ x: 0, y: 0 });
    expect(mode.active).toBe(false);
    mode.move({ x: 5, y: 5 });
    expect(shapes).toHaveLength(0);
  });

  it("emits a normalized draft on move and a committed extent on release", () => {
    const { mode, shapes } = setup("rectangle");
    mode.press({ x: 10, y: 60 });
    expect(mode.active).toBe(true);
    // Drag up-and-right — corners come back ordered min→max.
    mode.move({ x: 40, y: 20 });
    mode.release({ x: 40, y: 20 });
    expect(mode.active).toBe(false);

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
    mode.press({ x: 5, y: 5 });
    mode.release({ x: 5, y: 5 }); // a click, never dragged

    expect(shapes).toEqual([{ kind: "ellipse", extent: null, draft: false }]);
  });

  it("ignores double-click and keys (press-drag has no such finish)", () => {
    const { mode } = setup("rectangle");
    mode.finish();
    expect(mode.key(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(
      false,
    );
  });

  it("cancel drops an in-flight drag (extent:null), never committing a shape", () => {
    const { mode, shapes } = setup("ellipse");
    mode.press({ x: 0, y: 0 });
    mode.cancel();
    expect(mode.active).toBe(false);
    // The drop signal clears the host preview without creating a shape.
    expect(shapes).toEqual([{ kind: "ellipse", extent: null, draft: false }]);
    // Moves after a cancel are no-ops.
    mode.move({ x: 30, y: 30 });
    expect(shapes).toHaveLength(1);
  });

  it("cancel with nothing in flight emits nothing", () => {
    const { mode, shapes } = setup("rectangle");
    mode.cancel();
    expect(shapes).toHaveLength(0);
  });
});
