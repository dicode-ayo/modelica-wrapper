import { beforeEach, describe, expect, it, vi } from "vitest";
import { Container, type Graphics } from "pixi.js";

vi.mock("../src/base/overlay-mesh.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/base/overlay-mesh.js")>()),
  buildWireMesh: vi.fn(() => null),
  buildRectMesh: vi.fn(() => ({}) as unknown as Graphics),
  updateRectMesh: vi.fn(),
  disposeOverlayMesh: vi.fn(),
}));

import { SelectMode } from "../src/interaction/select-mode.js";
import type {
  DragEvents,
  GestureStart,
} from "../src/interaction/gesture-mode.js";
import {
  buildRectMesh,
  updateRectMesh,
  disposeOverlayMesh,
} from "../src/base/overlay-mesh.js";

function setup(): { mode: SelectMode; rects: DragEvents["rubberBand"][] } {
  const rects: DragEvents["rubberBand"][] = [];
  const mode = new SelectMode((type, detail) => {
    if (type === "rubberBand") rects.push(detail as DragEvents["rubberBand"]);
  }, new Container());
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

function nth<T>(arr: readonly T[], i: number): T {
  const v = arr.at(i);
  if (v === undefined) {
    throw new Error(`expected element ${i}`);
  }
  return v;
}

describe("SelectMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rubber-bands a rectangle from begin through commit", () => {
    const { mode, rects } = setup();

    expect(mode.begin(emptyStart({ x: 5, y: 5 }))).toBe(true);
    // Built once on begin.
    expect(buildRectMesh).toHaveBeenCalledTimes(1);
    expect(updateRectMesh).not.toHaveBeenCalled();

    mode.update({ x: 40, y: 30 });
    // Updated in place on move — no rebuild, so no flicker.
    expect(buildRectMesh).toHaveBeenCalledTimes(1);
    expect(updateRectMesh).toHaveBeenCalledTimes(1);
    expect(nth(vi.mocked(updateRectMesh).mock.calls, -1)[1]).toEqual({
      x1: 5,
      y1: 5,
      x2: 40,
      y2: 30,
    });

    // The rubberBand events still drive the host's selection.
    expect(rects).toHaveLength(2);
    expect(nth(rects, 0)).toMatchObject({
      rect: { x1: 5, y1: 5, x2: 5, y2: 5 },
      draft: true,
    });

    const disposesBefore = vi.mocked(disposeOverlayMesh).mock.calls.length;
    mode.commit({ x: 40, y: 30 });

    expect(nth(rects, 2)).toMatchObject({
      rect: { x1: 5, y1: 5, x2: 40, y2: 30 },
      draft: false,
    });
    // Commit clears the rect.
    expect(vi.mocked(disposeOverlayMesh).mock.calls.length).toBe(
      disposesBefore + 1,
    );
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
    expect(buildRectMesh).not.toHaveBeenCalled();
  });
});
