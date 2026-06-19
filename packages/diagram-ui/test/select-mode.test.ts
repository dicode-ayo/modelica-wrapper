import { describe, expect, it } from "vitest";

import { SelectMode } from "../src/interaction/select-mode.js";
import type {
  DragEvents,
  GestureStart,
} from "../src/interaction/gesture-mode.js";
import { fakeOverlay, type RecordingOverlay } from "./harness/fake-overlay.js";

function setup(): {
  mode: SelectMode;
  rects: DragEvents["rubberBand"][];
  overlay: RecordingOverlay;
} {
  const rects: DragEvents["rubberBand"][] = [];
  const overlay = fakeOverlay();
  const mode = new SelectMode((type, detail) => {
    if (type === "rubberBand") rects.push(detail as DragEvents["rubberBand"]);
  }, overlay);
  return { mode, rects, overlay };
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
    const { mode, rects, overlay } = setup();

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

    // The overlay drew the rect on begin + update, and cleared it on commit.
    expect(overlay.rects).toHaveLength(2);
    expect(overlay.rects.at(-1)).toEqual({ x1: 5, y1: 5, x2: 40, y2: 30 });
    expect(overlay.rectHidden).toBe(1);
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
