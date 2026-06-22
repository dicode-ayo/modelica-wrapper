import { describe, expect, it } from "vitest";

import { ExtentToolMode } from "../src/interaction/extent-tool-mode.js";
import type { ToolDraw } from "../src/interaction/tool-mode.js";
import type { SnapGrid } from "../src/interaction/snap-math.js";
import type { ExtentKind } from "../src/interaction/tools.js";

function setup(
  kind: ExtentKind | null,
  grid: SnapGrid = [0, 0],
): { mode: ExtentToolMode; draws: ToolDraw[] } {
  const draws: ToolDraw[] = [];
  const mode = new ExtentToolMode(
    (draw) => draws.push(draw),
    () => kind,
    () => grid,
  );
  return { mode, draws };
}

describe("ExtentToolMode", () => {
  it("is a press-drag tool and inactive before a press", () => {
    const { mode } = setup("rectangle");
    expect(mode.pressDrag).toBe(true);
    expect(mode.active).toBe(false);
  });

  it("does nothing when the select tool is armed (no kind)", () => {
    const { mode, draws } = setup(null);
    mode.press({ x: 0, y: 0 });
    expect(mode.active).toBe(false);
    mode.move({ x: 5, y: 5 });
    expect(draws).toHaveLength(0);
  });

  it("drafts a normalized shape on move and commits the snapped shape on release", () => {
    const { mode, draws } = setup("rectangle");
    mode.press({ x: 10, y: 60 });
    expect(mode.active).toBe(true);
    // Drag up-and-right — corners come back ordered min→max.
    mode.move({ x: 40, y: 20 });
    mode.release({ x: 40, y: 20 });
    expect(mode.active).toBe(false);

    const shape = {
      kind: "rectangle",
      extent: [
        [10, 20],
        [40, 60],
      ],
      lineColor: [0, 0, 0],
    };
    expect(draws).toEqual([
      { phase: "draft", shape },
      { phase: "commit", shape },
    ]);
  });

  it("snaps the committed extent to the grid", () => {
    const { mode, draws } = setup("rectangle", [10, 10]);
    mode.press({ x: 2, y: 3 });
    mode.release({ x: 41, y: 48 });
    const commit = draws.at(-1);
    expect(commit).toMatchObject({ phase: "commit" });
    if (commit?.phase === "commit") {
      expect(commit.shape).toMatchObject({
        extent: [
          [0, 0],
          [40, 50],
        ],
      });
    }
  });

  it("cancels (no shape) on a degenerate release", () => {
    const { mode, draws } = setup("ellipse");
    mode.press({ x: 5, y: 5 });
    mode.release({ x: 5, y: 5 }); // a click, never dragged
    expect(draws).toEqual([{ phase: "cancel" }]);
  });

  it("cancels when grid-snapping collapses a thin drag to zero size", () => {
    const { mode, draws } = setup("rectangle", [10, 10]);
    mode.press({ x: 11, y: 0 });
    mode.release({ x: 14, y: 40 }); // x-span 3 → both snap to 10 → zero width
    expect(draws.at(-1)).toEqual({ phase: "cancel" });
  });

  it("ignores double-click and keys (press-drag has no such finish)", () => {
    const { mode } = setup("rectangle");
    mode.finish();
    expect(mode.key(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(
      false,
    );
  });

  it("cancel drops an in-flight drag, never committing a shape", () => {
    const { mode, draws } = setup("ellipse");
    mode.press({ x: 0, y: 0 });
    mode.cancel();
    expect(mode.active).toBe(false);
    expect(draws).toEqual([{ phase: "cancel" }]);
    // Moves after a cancel are no-ops.
    mode.move({ x: 30, y: 30 });
    expect(draws).toHaveLength(1);
  });

  it("cancel with nothing in flight emits nothing", () => {
    const { mode, draws } = setup("rectangle");
    mode.cancel();
    expect(draws).toHaveLength(0);
  });
});
