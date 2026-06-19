import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene, TransformNode } from "@babylonjs/core";

vi.mock("../src/base/overlay-mesh.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/base/overlay-mesh.js")>()),
  buildWireMesh: vi.fn(() => null),
  buildRectMesh: vi.fn(() => null),
  disposeOverlayMesh: vi.fn(),
}));

import { SelectMode } from "../src/interaction/select-mode.js";
import type {
  DragEvents,
  GestureStart,
} from "../src/interaction/gesture-mode.js";
import { buildRectMesh, disposeOverlayMesh } from "../src/base/overlay-mesh.js";

const NO_SCENE = {} as Scene;
const NO_PARENT = {} as TransformNode;

function setup(): { mode: SelectMode; rects: DragEvents["rubberBand"][] } {
  const rects: DragEvents["rubberBand"][] = [];
  const mode = new SelectMode(
    (type, detail) => {
      if (type === "rubberBand") rects.push(detail as DragEvents["rubberBand"]);
    },
    NO_SCENE,
    NO_PARENT,
  );
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rubber-bands a rectangle from begin through commit", () => {
    const { mode, rects } = setup();

    expect(mode.begin(emptyStart({ x: 5, y: 5 }))).toBe(true);
    mode.update({ x: 40, y: 30 });

    expect(rects).toHaveLength(2);
    expect(rects[0]!).toMatchObject({
      rect: { x1: 5, y1: 5, x2: 5, y2: 5 },
      draft: true,
    });

    // The rect is drawn on begin + update.
    expect(buildRectMesh).toHaveBeenCalledTimes(2);
    expect(vi.mocked(buildRectMesh).mock.calls.at(-1)![2]).toEqual({
      x1: 5,
      y1: 5,
      x2: 40,
      y2: 30,
    });

    const disposesBefore = vi.mocked(disposeOverlayMesh).mock.calls.length;
    mode.commit({ x: 40, y: 30 });

    expect(rects[2]!).toMatchObject({
      rect: { x1: 5, y1: 5, x2: 40, y2: 30 },
      draft: false,
    });
    // Commit clears the rect and does not draw a new one.
    expect(buildRectMesh).toHaveBeenCalledTimes(2);
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
