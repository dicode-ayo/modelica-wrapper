import { describe, expect, it } from "vitest";

import { SelectMode } from "../src/interaction/select-mode.js";
import type {
  DragEvents,
  GestureStart,
} from "../src/interaction/gesture-mode.js";

function setup(): {
  mode: SelectMode;
  rects: DragEvents["rubberBand"][];
} {
  const rects: DragEvents["rubberBand"][] = [];
  const mode = new SelectMode((type, detail) => {
    if (type === "rubberBand") rects.push(detail as DragEvents["rubberBand"]);
  });
  return { mode, rects };
}

function emptyStart(point: { x: number; y: number }): GestureStart {
  return {
    node: null,
    entity: null,
    point,
    shiftKey: false,
    getSelectionKeys: () => [],
  };
}

describe("SelectMode", () => {
  it("rubber-bands a rectangle from begin through commit", () => {
    const { mode, rects } = setup();

    expect(mode.begin(emptyStart({ x: 5, y: 5 }))).toBe(true);
    mode.update({ x: 40, y: 30 });
    mode.commit({ x: 40, y: 30 });

    expect(rects).toHaveLength(3);
    expect(rects[0]!).toMatchObject({
      rect: { x1: 5, y1: 5, x2: 5, y2: 5 },
      draft: true,
    });
    expect(rects[2]!).toMatchObject({
      rect: { x1: 5, y1: 5, x2: 40, y2: 30 },
      draft: false,
    });
  });

  it("does not start when the press lands on an entity", () => {
    const { mode, rects } = setup();
    const started = mode.begin({
      node: null,
      entity: { kind: "component", nodeId: "R1" },
      point: { x: 5, y: 5 },
      shiftKey: false,
      getSelectionKeys: () => [],
    });
    expect(started).toBe(false);
    expect(rects).toHaveLength(0);
  });
});
