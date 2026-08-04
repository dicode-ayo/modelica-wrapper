import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";

import { DragMode } from "../src/interaction/drag-mode.js";
import type {
  DragEvents,
  GestureStart,
} from "../src/interaction/gesture-mode.js";
import { entityKeyForNode, tagEntity } from "../src/interaction/node-keys.js";

/** A tagged entity container, optionally parented under an owner. */
function node(
  kind: Parameters<typeof tagEntity>[1],
  nodeId: string,
  parent?: Container,
): Container {
  const c = new Container();
  tagEntity(c, kind, nodeId);
  parent?.addChild(c);
  return c;
}

interface CapturedEvent<K extends keyof DragEvents> {
  type: K;
  detail: DragEvents[K];
}

function setup(): {
  mode: DragMode;
  events: CapturedEvent<keyof DragEvents>[];
} {
  const events: CapturedEvent<keyof DragEvents>[] = [];
  const mode = new DragMode(
    <K extends keyof DragEvents>(type: K, detail: DragEvents[K]) => {
      events.push({ type, detail } as CapturedEvent<keyof DragEvents>);
    },
  );
  return { mode, events };
}

function start(
  node: Container | null,
  point: { x: number; y: number },
  opts: { shiftKey?: boolean; selection?: string[] } = {},
): GestureStart {
  return {
    node,
    entity: entityKeyForNode(node),
    point,
    shiftKey: opts.shiftKey ?? false,
    getSelectionKeys: () => opts.selection ?? [],
    clientX: point.x,
    clientY: point.y,
  };
}

const move = (x: number, y: number) =>
  new PointerEvent("pointermove", { clientX: x, clientY: y });

describe("DragMode", () => {
  it("emits drag events when a component is dragged", () => {
    const tn = node("component", "R1");
    const { mode, events } = setup();

    expect(mode.begin(start(tn, { x: 10, y: 10 }))).toBe(true);
    mode.update({ x: 30, y: 25 }, move(30, 25));
    mode.commit({ x: 30, y: 25 }, move(30, 25));

    const drags = events.filter((e) => e.type === "drag");
    expect(drags.length).toBe(2);
    expect(drags[0]!.detail).toMatchObject({
      keys: ["c:R1"],
      dx: 20,
      dy: 15,
      draft: true,
    });
    expect(drags[1]!.detail).toMatchObject({
      keys: ["c:R1"],
      dx: 20,
      dy: 15,
      draft: false,
    });
  });

  it("drags the full selection when the clicked entity is already selected", () => {
    const tn = node("component", "R1");
    const { mode, events } = setup();

    mode.begin(start(tn, { x: 0, y: 0 }, { selection: ["c:R1", "c:C1"] }));
    mode.update({ x: 5, y: 5 }, move(5, 5));

    const drag = events.find((e) => e.type === "drag") as
      | CapturedEvent<"drag">
      | undefined;
    expect(drag).toBeDefined();
    expect(drag!.detail.keys.sort()).toEqual(["c:C1", "c:R1"]);
  });

  it.each(["tl", "tr", "br", "bl"] as const)(
    "emits resize on the %s handle with the matching corner",
    (corner) => {
      const ownerTn = node("component", "R1");
      const handle = node("handle", corner, ownerTn);
      const { mode, events } = setup();

      mode.begin(start(handle, { x: 100, y: 50 }));
      mode.update({ x: 120, y: 70 }, move(120, 70));
      mode.commit({ x: 120, y: 70 }, move(120, 70));

      const resizes = events.filter((e) => e.type === "resize");
      expect(resizes).toHaveLength(3); // start + move + commit
      expect(resizes[0]!.detail).toMatchObject({
        key: "c:R1",
        corner,
        draft: true,
      });
      expect(resizes[2]!.detail).toMatchObject({ draft: false });
    },
  );

  it("emits draft rotate on begin + move, then a commit", () => {
    const ownerTn = node("component", "R1");
    const rotate = node("rotate-handle", "rotate", ownerTn);
    const { mode, events } = setup();

    mode.begin(start(rotate, { x: 40, y: 10 }));
    mode.update({ x: 60, y: 30 }, move(60, 30));
    mode.commit({ x: 60, y: 30 }, move(60, 30));

    const rotates = events.filter((e) => e.type === "rotate");
    expect(rotates.map((e) => e.detail)).toEqual([
      { key: "c:R1", x: 40, y: 10, free: false, draft: true },
      { key: "c:R1", x: 60, y: 30, free: false, draft: true },
      { key: "c:R1", x: 60, y: 30, free: false, draft: false },
    ]);
  });

  it("flags `free` when Shift is held during a rotate move", () => {
    const ownerTn = node("component", "R1");
    const rotate = node("rotate-handle", "rotate", ownerTn);
    const { mode, events } = setup();

    mode.begin(start(rotate, { x: 40, y: 10 }));
    mode.update(
      { x: 60, y: 30 },
      new PointerEvent("pointermove", {
        shiftKey: true,
        clientX: 60,
        clientY: 30,
      }),
    );

    const last = events.filter((e) => e.type === "rotate").at(-1);
    if (last === undefined) throw new Error("expected a rotate event");
    expect(last.detail).toMatchObject({ free: true, draft: true });
  });

  it("emits edgeDrag with the grab point and cumulative delta", () => {
    const edge = node("edge", "0");
    const { mode, events } = setup();

    mode.begin(start(edge, { x: 100, y: 50 }));
    mode.update({ x: 130, y: 60 }, move(130, 60));
    mode.commit({ x: 130, y: 60 }, move(130, 60));

    const edgeDrags = events.filter((e) => e.type === "edgeDrag");
    expect(edgeDrags.length).toBe(2);
    expect(edgeDrags[0]!.detail).toMatchObject({
      connIdx: 0,
      grab: { x: 100, y: 50 },
      dx: 30,
      dy: 10,
      draft: true,
    });
    expect(edgeDrags[1]!.detail).toMatchObject({ draft: false });
  });

  it("does not start on an edge with a non-numeric index", () => {
    const edge = node("edge", "x");
    const { mode } = setup();

    expect(mode.begin(start(edge, { x: 0, y: 0 }))).toBe(false);
  });
});

/** `DragEvents` is a union, so `type` alone can't narrow `detail`. */
function isDragEvent(
  e: CapturedEvent<keyof DragEvents>,
): e is CapturedEvent<"drag"> {
  return e.type === "drag";
}

function isResizeEvent(
  e: CapturedEvent<keyof DragEvents>,
): e is CapturedEvent<"resize"> {
  return e.type === "resize";
}

describe("DragMode drag slop", () => {
  /**
   * The second press of a double-click starts a drag on the entity already
   * under the cursor. Committed, the mouse-up passes ran over it — the grid
   * snap moved an off-grid entity, the angle snap squared a freely rotated one
   * — so double-clicking a shape to open its properties edited it, and the
   * properties submit was then refused for having a stale snapshot.
   */
  it("cancels rather than commits when the press never leaves the slop", () => {
    const tn = node("component", "R1");
    const { mode, events } = setup();

    expect(mode.begin(start(tn, { x: 100, y: 100 }))).toBe(true);
    mode.update({ x: 102, y: 102 }, move(102, 102));
    mode.commit({ x: 102, y: 102 }, move(102, 102));

    expect(events.at(-1)?.type).toBe("dragCancel");
    expect(events.filter(isDragEvent).filter((e) => !e.detail.draft)).toEqual(
      [],
    );
  });

  it("cancels a handle press too, so a click on one leaves no draft behind", () => {
    // `resize` drafts from `begin`, so without the cancel the preview and the
    // interaction state would have nothing left to end them.
    const wrapper = node("shape", "rectangle:0");
    const handle = node("handle", "br");
    wrapper.addChild(handle);
    const { mode, events } = setup();

    expect(mode.begin(start(handle, { x: 100, y: 100 }))).toBe(true);
    mode.commit({ x: 103, y: 103 }, move(103, 103));

    expect(events.at(-1)?.type).toBe("dragCancel");
    // And no committed resize, which would have re-snapped the corner.
    expect(events.filter(isResizeEvent).filter((e) => !e.detail.draft)).toEqual(
      [],
    );
  });

  it("commits a move once the press travels past the slop", () => {
    const tn = node("component", "R1");
    const { mode, events } = setup();

    expect(mode.begin(start(tn, { x: 100, y: 100 }))).toBe(true);
    mode.update({ x: 140, y: 100 }, move(140, 100));
    mode.commit({ x: 140, y: 100 }, move(140, 100));

    const committed = events.filter(isDragEvent).filter((e) => !e.detail.draft);
    expect(committed).toHaveLength(1);
    expect(committed.at(0)?.detail).toMatchObject({ dx: 40, dy: 0 });
  });
});
