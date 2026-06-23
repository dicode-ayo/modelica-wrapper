import { describe, expect, it } from "vitest";

import { MultiClickToolMode } from "../src/interaction/multi-click-tool-mode.js";
import type { ToolDraw } from "../src/interaction/tool-mode.js";
import type { SnapGrid } from "../src/interaction/snap-math.js";
import type { PolyKind } from "../src/interaction/tools.js";

function setup(
  kind: PolyKind | null,
  grid: SnapGrid = [0, 0],
): { mode: MultiClickToolMode; events: ToolDraw[] } {
  const events: ToolDraw[] = [];
  const mode = new MultiClickToolMode(
    (draw) => events.push(draw),
    () => kind,
    () => grid,
  );
  return { mode, events };
}

describe("MultiClickToolMode", () => {
  it("is a click tool, inactive before the first press", () => {
    const { mode } = setup("line");
    expect(mode.pressDrag).toBe(false);
    expect(mode.active).toBe(false);
  });

  it("places a vertex per press and rubber-bands the cursor on move", () => {
    const { mode, events } = setup("line");
    mode.press({ x: 0, y: 0 });
    expect(mode.active).toBe(true);
    mode.move({ x: 10, y: 10 });
    expect(events.at(-1)).toEqual({
      phase: "draft",
      shape: {
        kind: "line",
        points: [
          [0, 0],
          [10, 10],
        ],
        color: [0, 0, 0],
      },
    });
  });

  it("previews a one-segment polygon as a line so the first drag is visible", () => {
    const { mode, events } = setup("polygon");
    mode.press({ x: 0, y: 0 });
    mode.move({ x: 10, y: 10 });
    // Only two draft points → render as a line, not an invisible 2-pt polygon.
    expect(events.at(-1)).toMatchObject({
      phase: "draft",
      shape: { kind: "line" },
    });
  });

  it("commits a line on finish (double-click) carrying the placed vertices", () => {
    const { mode, events } = setup("line");
    mode.press({ x: 0, y: 0 });
    mode.press({ x: 10, y: 0 });
    mode.finish();
    expect(events.at(-1)).toEqual({
      phase: "commit",
      shape: {
        kind: "line",
        points: [
          [0, 0],
          [10, 0],
        ],
        color: [0, 0, 0],
      },
    });
    expect(mode.active).toBe(false);
  });

  it("undoes the last vertex on Backspace, then finishes on Enter", () => {
    const { mode, events } = setup("polygon");
    mode.press({ x: 0, y: 0 });
    mode.press({ x: 10, y: 0 });
    mode.press({ x: 10, y: 10 });
    mode.move({ x: 20, y: 20 });
    // Backspace drops the [10,10] vertex; the draft keeps the two earlier
    // vertices plus the live cursor.
    expect(mode.key(new KeyboardEvent("keydown", { key: "Backspace" }))).toBe(
      true,
    );
    expect(events.at(-1)).toMatchObject({
      phase: "draft",
      shape: {
        points: [
          [0, 0],
          [10, 0],
          [20, 20],
        ],
      },
    });
    mode.press({ x: 10, y: 10 });
    expect(mode.key(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(true);
    expect(events.at(-1)).toEqual({
      phase: "commit",
      shape: {
        kind: "polygon",
        points: [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        lineColor: [0, 0, 0],
      },
    });
  });

  it("cancels the whole gesture on Escape", () => {
    const { mode, events } = setup("line");
    mode.press({ x: 0, y: 0 });
    mode.press({ x: 10, y: 0 });
    expect(mode.key(new KeyboardEvent("keydown", { key: "Escape" }))).toBe(
      true,
    );
    expect(events.at(-1)).toEqual({ phase: "cancel" });
    expect(mode.active).toBe(false);
  });

  it("keys are not consumed when no gesture is in flight", () => {
    const { mode } = setup("line");
    expect(mode.key(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(
      false,
    );
  });

  it("a click back on the start vertex closes a finishable polygon", () => {
    // Grid {2,2}: snapped clicks land on cells; a click on the start cell
    // closes the path (half-cell tolerance).
    const { mode, events } = setup("polygon", [2, 2]);
    mode.press({ x: 0, y: 0 });
    mode.press({ x: 10, y: 0 });
    mode.press({ x: 10, y: 10 });
    mode.press({ x: 0, y: 0 }); // back on the start → finish
    expect(events.at(-1)).toEqual({
      phase: "commit",
      shape: {
        kind: "polygon",
        points: [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        lineColor: [0, 0, 0],
      },
    });
    expect(mode.active).toBe(false);
  });
});
