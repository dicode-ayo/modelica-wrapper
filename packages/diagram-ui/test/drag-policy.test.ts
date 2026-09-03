import { describe, expect, it } from "vitest";
import type { DiagramLayout, Shape } from "@dicode/omc-client";

import {
  resolveDrag,
  type AnyDragEvent,
  type DragContext,
  type DragEffect,
} from "../src/interaction/drag-policy.js";
import { NO_SNAP } from "../src/interaction/snap-math.js";
import {
  baseLayout,
  withRoute,
  withShapes,
} from "./harness/layout-fixtures.js";

/**
 * The gesture-to-layout seam: which op a drag runs, what it snaps to, and
 * whether it drafts or commits. Every case is reachable here without a
 * renderer — the policy takes a layout and an event and answers in effects.
 */

function context(over: Partial<DragContext> = {}): DragContext {
  return {
    layout: baseLayout(),
    readonly: false,
    grid: [2, 2],
    rotateSnapDegrees: 5,
    selectedKeys: new Set(),
    connectorPosition: () => null,
    ...over,
  };
}

function effects(
  event: AnyDragEvent,
  over: Partial<DragContext> = {},
): DragEffect[] {
  return resolveDrag(event, context(over));
}

function kinds(list: DragEffect[]): string[] {
  return list.map((e) => e.kind);
}

function isLayoutEffect(
  e: DragEffect,
): e is Extract<DragEffect, { kind: "draft" | "commit" }> {
  return e.kind === "draft" || e.kind === "commit";
}

/** The single layout an effect list drafts or commits. */
function layoutOf(list: DragEffect[]): DiagramLayout {
  const found = list.find(isLayoutEffect);
  if (found === undefined) {
    throw new Error(`no draft / commit effect in [${kinds(list).join(", ")}]`);
  }
  return found.layout;
}

function extentOf(layout: DiagramLayout, id: string): unknown {
  return layout.components[id]?.placement.extent;
}

/** `baseLayout()` with `R1` placed off every grid intersection. */
function offGrid(): DiagramLayout {
  const base = baseLayout();
  const r1 = base.components["R1"];
  if (r1 === undefined) {
    throw new Error("fixture lost R1");
  }
  return {
    ...base,
    components: {
      ...base.components,
      R1: {
        ...r1,
        placement: {
          extent: [
            [3, 7],
            [23, 27],
          ],
        },
      },
    },
  };
}

const TRIANGLE: Shape = {
  kind: "polygon",
  points: [
    [0, 0],
    [10, 0],
    [5, 10],
  ],
  lineColor: [0, 0, 0],
};

describe("dragCancel", () => {
  it("drops the draft and commits nothing", () => {
    expect(kinds(effects({ type: "dragCancel", detail: {} }))).toEqual([
      "dropDraft",
      "endInteraction",
    ]);
  });
});

describe("drag", () => {
  it("drafts the snapped delta without committing", () => {
    const list = effects({
      type: "drag",
      detail: { keys: ["c:R1"], dx: 5, dy: 0, draft: true },
    });
    expect(kinds(list)).toEqual(["draft", "state"]);
    // 5 rounds onto the [2, 2] grid.
    expect(extentOf(layoutOf(list), "R1")).toEqual([
      [-4, -5],
      [16, 5],
    ]);
  });

  it("reports what is moving while the drag is live", () => {
    const list = effects({
      type: "drag",
      detail: { keys: ["c:R1", "c:C1"], dx: 2, dy: 2, draft: true },
    });
    expect(list[1]).toEqual({
      kind: "state",
      state: { kind: "moving", keys: ["c:R1", "c:C1"] },
    });
  });

  it("snaps the moved entity onto the grid on commit, not on draft", () => {
    const layout = offGrid();
    const drafted = effects(
      {
        type: "drag",
        detail: { keys: ["c:R1"], dx: 2, dy: 2, draft: true },
      },
      { layout },
    );
    // The delta is on-grid, so a draft leaves the off-grid offset intact.
    expect(extentOf(layoutOf(drafted), "R1")).toEqual([
      [5, 9],
      [25, 29],
    ]);

    const committed = effects(
      {
        type: "drag",
        detail: { keys: ["c:R1"], dx: 2, dy: 2, draft: false },
      },
      { layout },
    );
    expect(extentOf(layoutOf(committed), "R1")).toEqual([
      [6, 10],
      [26, 30],
    ]);
  });

  it("moves a standalone connector and grid-snaps it on commit like a component", () => {
    const base = baseLayout();
    const p = base.connectors["p"];
    if (p === undefined) {
      throw new Error("fixture lost p");
    }
    const layout: DiagramLayout = {
      ...base,
      connectors: {
        ...base.connectors,
        p: {
          ...p,
          placement: {
            extent: [
              [-50.5, -2],
              [-46.5, 2],
            ],
          },
        },
      },
    };
    const committed = effects(
      { type: "drag", detail: { keys: ["k:p"], dx: 2, dy: 0, draft: false } },
      { layout },
    );
    expect(layoutOf(committed).connectors["p"]?.placement.extent).toEqual([
      [-48, -2],
      [-44, 2],
    ]);
  });

  it("leaves an off-grid entity alone when the grid is disabled", () => {
    const layout = offGrid();
    const list = effects(
      {
        type: "drag",
        detail: { keys: ["c:R1"], dx: 1, dy: 1, draft: false },
      },
      { layout, grid: NO_SNAP },
    );
    expect(extentOf(layoutOf(list), "R1")).toEqual([
      [4, 8],
      [24, 28],
    ]);
  });

  it("reshapes the route when the drag carries a lone junction", () => {
    const layout = withRoute([
      [0, 0],
      [5, 0],
      [5, 10],
      [10, 10],
    ]);
    const list = effects(
      {
        type: "drag",
        detail: { keys: ["junc:0/1"], dx: 4, dy: 2, draft: false },
      },
      { layout },
    );
    expect(kinds(list)).toEqual(["commit", "endInteraction"]);
    expect(layoutOf(list).connections[0]?.waypoints).toEqual([
      [0, 0],
      [9, 0],
      [9, 2],
      [5, 2],
      [5, 10],
      [10, 10],
    ]);
  });

  it("commits the layout unchanged for a malformed junction id", () => {
    const layout = baseLayout();
    const list = effects(
      {
        type: "drag",
        detail: { keys: ["junc:x/y"], dx: 4, dy: 0, draft: false },
      },
      { layout },
    );
    expect(layoutOf(list)).toBe(layout);
  });
});

describe("edgeDrag", () => {
  it("moves the grabbed segment perpendicular to itself", () => {
    const layout = withRoute([
      [0, 0],
      [20, 0],
      [20, 20],
      [40, 20],
    ]);
    const list = effects(
      {
        type: "edgeDrag",
        detail: {
          connIdx: 0,
          grab: { x: 20, y: 10 },
          dx: 6,
          dy: 4,
          draft: true,
        },
      },
      { layout },
    );
    expect(kinds(list)).toEqual(["draft", "state"]);
    expect(list[1]).toEqual({
      kind: "state",
      state: { kind: "moving", keys: ["edge:0"] },
    });
    expect(layoutOf(list).connections[0]?.waypoints).toEqual([
      [0, 0],
      [26, 0],
      [26, 20],
      [40, 20],
    ]);
  });

  it("commits and stands down on release", () => {
    const layout = withRoute([
      [0, 0],
      [20, 0],
      [20, 20],
      [40, 20],
    ]);
    const list = effects(
      {
        type: "edgeDrag",
        detail: {
          connIdx: 0,
          grab: { x: 20, y: 10 },
          dx: 6,
          dy: 0,
          draft: false,
        },
      },
      { layout },
    );
    expect(kinds(list)).toEqual(["commit", "endInteraction"]);
  });
});

describe("rubberBand", () => {
  const band = {
    rect: { x1: -60, y1: -40, x2: 0, y2: 40 },
    draft: true,
  } as const;

  it("previews the selection without announcing it", () => {
    const list = effects({ type: "rubberBand", detail: { ...band } });
    expect(list).toEqual([
      { kind: "selection", keys: new Set(["c:R1", "k:p"]), emit: false },
      { kind: "state", state: { kind: "selecting" } },
    ]);
  });

  it("announces the selection on release", () => {
    const list = effects({
      type: "rubberBand",
      detail: { ...band, draft: false },
    });
    expect(list).toEqual([
      { kind: "selection", keys: new Set(["c:R1", "k:p"]), emit: true },
      { kind: "endInteraction" },
    ]);
  });

  it("still runs on a read-only class", () => {
    const list = effects(
      { type: "rubberBand", detail: { ...band } },
      { readonly: true },
    );
    expect(kinds(list)).toEqual(["selection", "state"]);
  });
});

describe("connection", () => {
  const from = { from: "k:p", to: { x: 5, y: 5 }, fromPoint: { x: 0, y: 0 } };

  it("mirrors the live drag to the host", () => {
    const list = effects({
      type: "connection",
      detail: { ...from, toKey: "k:R1.p", compat: { ok: true }, commit: false },
    });
    expect(list).toEqual([
      {
        kind: "connectionDrag",
        value: { from: "k:p", toKey: "k:R1.p", compat: { ok: true } },
      },
      {
        kind: "state",
        state: { kind: "connecting", fromKey: "k:p", toKey: "k:R1.p" },
      },
    ]);
  });

  it("creates the connection, routed to the target's live position", () => {
    const list = effects(
      {
        type: "connection",
        detail: { ...from, toKey: "k:R1.p", compat: null, commit: true },
      },
      { connectorPosition: () => ({ x: 20, y: 0 }) },
    );
    expect(list).toEqual([
      { kind: "connectionDrag", value: null },
      {
        kind: "connectionCreate",
        fromKey: "k:p",
        toKey: "k:R1.p",
        waypoints: [
          [0, 0],
          [20, 0],
        ],
      },
      { kind: "endInteraction" },
    ]);
  });

  it("creates an unrouted connection when the target has no live position", () => {
    const list = effects({
      type: "connection",
      detail: { ...from, toKey: "k:R1.p", compat: null, commit: true },
    });
    expect(list[1]).toMatchObject({
      kind: "connectionCreate",
      waypoints: [],
    });
  });

  it("creates nothing when the drop is incompatible", () => {
    const list = effects({
      type: "connection",
      detail: {
        ...from,
        toKey: "k:R1.p",
        compat: { ok: false, reason: "mismatch" },
        commit: true,
      },
    });
    expect(kinds(list)).toEqual(["connectionDrag", "endInteraction"]);
  });

  it("creates nothing when the drop lands in empty space", () => {
    const list = effects({
      type: "connection",
      detail: { ...from, toKey: null, compat: null, commit: true },
    });
    expect(kinds(list)).toEqual(["connectionDrag", "endInteraction"]);
  });
});

describe("resize", () => {
  it("snaps the dragged corner to the grid", () => {
    const list = effects({
      type: "resize",
      detail: { key: "c:R1", corner: "tr", x: 21, y: 15, draft: true },
    });
    expect(kinds(list)).toEqual(["draft", "state"]);
    expect(extentOf(layoutOf(list), "R1")).toEqual([
      [-10, -5],
      [22, 16],
    ]);
    expect(list[1]).toEqual({
      kind: "state",
      state: { kind: "resizing", key: "c:R1", corner: "tr" },
    });
  });

  it("commits and stands down on release", () => {
    const list = effects({
      type: "resize",
      detail: { key: "c:R1", corner: "tr", x: 20, y: 10, draft: false },
    });
    expect(kinds(list)).toEqual(["commit", "endInteraction"]);
  });
});

describe("rotate", () => {
  /** Due east of `R1`'s centre — 90° clockwise off the handle's north. */
  const east = { key: "c:R1", x: 100, y: 0, free: false, draft: true };

  it("snaps the angle to the configured increment", () => {
    const list = effects({
      type: "rotate",
      detail: { ...east, y: 3 },
    });
    expect(layoutOf(list).components["R1"]?.placement.rotation).toBe(270);
  });

  it("rotates freely when the gesture asks for it", () => {
    const list = effects({
      type: "rotate",
      detail: { ...east, y: 3, free: true },
    });
    const rotation = layoutOf(list).components["R1"]?.placement.rotation ?? 0;
    expect(rotation).toBeGreaterThan(270);
    expect(rotation).toBeLessThan(272);
  });

  it("carries the whole selection when the handle's owner is in it", () => {
    const list = effects(
      { type: "rotate", detail: east },
      { selectedKeys: new Set(["c:R1", "c:C1"]) },
    );
    const layout = layoutOf(list);
    expect(layout.components["C1"]?.placement.rotation).toBe(270);
    expect(list[1]).toEqual({
      kind: "state",
      state: { kind: "rotating", key: "c:R1" },
    });
  });

  it("does nothing when the handle's owner isn't in the layout", () => {
    expect(
      effects({ type: "rotate", detail: { ...east, key: "c:nope" } }),
    ).toEqual([]);
  });
});

describe("vertexDrag", () => {
  it("moves the addressed vertex to the snapped pointer", () => {
    const list = effects(
      {
        type: "vertexDrag",
        detail: { key: "vtx:polygon:0/2", x: 7, y: 21, draft: true },
      },
      { layout: withShapes([TRIANGLE]) },
    );
    expect(kinds(list)).toEqual(["draft", "state"]);
    const shape = layoutOf(list).diagramLayers.find((l) => l.from === "Demo")
      ?.shapes[0];
    expect(shape).toMatchObject({
      points: [
        [0, 0],
        [10, 0],
        [8, 22],
      ],
    });
    expect(list[1]).toEqual({
      kind: "state",
      state: { kind: "moving", keys: ["shape:polygon:0"] },
    });
  });

  it("commits and stands down on release", () => {
    const list = effects(
      {
        type: "vertexDrag",
        detail: { key: "vtx:polygon:0/2", x: 8, y: 22, draft: false },
      },
      { layout: withShapes([TRIANGLE]) },
    );
    expect(kinds(list)).toEqual(["commit", "endInteraction"]);
  });

  it("does nothing for a key that isn't a vertex handle", () => {
    expect(
      effects({
        type: "vertexDrag",
        detail: { key: "c:R1", x: 0, y: 0, draft: true },
      }),
    ).toEqual([]);
  });
});

describe("a read-only class", () => {
  const cases: AnyDragEvent[] = [
    { type: "dragCancel", detail: {} },
    { type: "drag", detail: { keys: ["c:R1"], dx: 2, dy: 2, draft: false } },
    {
      type: "edgeDrag",
      detail: { connIdx: 0, grab: { x: 0, y: 0 }, dx: 2, dy: 0, draft: false },
    },
    {
      type: "connection",
      detail: {
        from: "k:p",
        to: { x: 0, y: 0 },
        toKey: "k:R1.p",
        fromPoint: { x: 0, y: 0 },
        compat: null,
        commit: true,
      },
    },
    {
      type: "resize",
      detail: { key: "c:R1", corner: "tr", x: 20, y: 10, draft: false },
    },
    {
      type: "rotate",
      detail: { key: "c:R1", x: 100, y: 0, free: false, draft: false },
    },
    {
      type: "vertexDrag",
      detail: { key: "vtx:polygon:0/2", x: 8, y: 22, draft: false },
    },
  ];

  it.each(cases)("takes no effect from $type", (event) => {
    expect(effects(event, { readonly: true })).toEqual([]);
  });
});
