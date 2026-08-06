import type { DiagramLayout, Point } from "@dicode/omc-client";

import { orthogonalRoute } from "./connection-route.js";
import { parseKey, vertexShapeKey, type JunctionKey } from "./entity-keys.js";
import type { DragEvents } from "./gesture-mode.js";
import type { InteractionState } from "./interaction-state.js";
import {
  applyDeltaMove,
  applyResize,
  applyRotation,
  applyShapeVertexDrag,
  applySnapToExtents,
  shapeCentre,
} from "./layout-ops.js";
import {
  applyEdgeSegmentDrag,
  applyWaypointDrag,
  withMaterialisedRoute,
} from "./route-ops.js";
import { selectByDiagramRect } from "./selection-ops.js";
import { snapDelta, snapPoint, type SnapGrid } from "./snap-math.js";

/**
 * The policy layer between a pointer gesture and a layout edit: which op a
 * drag runs, what it snaps to, and whether the result is a live draft or a
 * commit.
 *
 * Snapping is applied twice on purpose and differently each time. Every
 * move is snapped in the *delta*, so components glide in whole grid steps;
 * only a commit snaps the resulting *extents*, which is what pulls an
 * entity that started off-grid onto an intersection. A gesture that ends
 * without having moved (`dragCancel`) must therefore not reach the commit
 * path at all — running the mouse-up passes over an entity the user merely
 * clicked would edit it (issue #404).
 */

/** Live connection drag, mirrored to the host for the port indicators. */
export interface InProgressConnection {
  from: string;
  toKey: string | null;
  compat: { ok: boolean; reason?: string } | null;
}

/** What a drag needs from the host that the layout doesn't carry. */
export interface DragContext {
  layout: DiagramLayout;
  /** Read-only classes take no edit; rubber-band selection still runs. */
  readonly: boolean;
  grid: SnapGrid;
  /** Angle snap for drag-to-rotate; `0` rotates freely. */
  rotateSnapDegrees: number;
  selectedKeys: ReadonlySet<string>;
  /**
   * Diagram position of a connector. Resolved from the live element tree —
   * the only input here that the layout can't answer, since it must reflect
   * an in-flight draft.
   */
  connectorPosition: (key: string) => { x: number; y: number } | null;
}

/**
 * A state change the host applies. The policy names them; it never touches
 * the component, so the whole gesture surface is reachable without a
 * renderer.
 */
export type DragEffect =
  /** Preview `layout` without persisting it. */
  | { kind: "draft"; layout: DiagramLayout }
  /** Abandon the preview, leaving the persisted layout as it was. */
  | { kind: "dropDraft" }
  /** Persist `layout`. Same reference as the input means no edit happened. */
  | { kind: "commit"; layout: DiagramLayout }
  | { kind: "state"; state: InteractionState }
  /** Return to hovering / idle and reconcile the port indicators. */
  | { kind: "endInteraction" }
  /** `emit` distinguishes a settled selection from a live preview. */
  | { kind: "selection"; keys: Set<string>; emit: boolean }
  | { kind: "connectionDrag"; value: InProgressConnection | null }
  | {
      kind: "connectionCreate";
      fromKey: string;
      toKey: string;
      waypoints: Point[];
    };

type DragEventFor<K extends keyof DragEvents> = {
  type: K;
  detail: DragEvents[K];
};

/** One emitted gesture event, discriminated by `type`. */
export type AnyDragEvent = {
  [K in keyof DragEvents]: DragEventFor<K>;
}[keyof DragEvents];

/** The effects `event` has on the layout and the interaction state. */
export function resolveDrag(
  event: AnyDragEvent,
  ctx: DragContext,
): DragEffect[] {
  // Rubber-band is the one gesture here that moves nothing — it only sets
  // the selection, so it stays live on a read-only class. Copying a
  // sub-system out of a system-library model needs multi-select.
  if (ctx.readonly && event.type !== "rubberBand") {
    return [];
  }
  switch (event.type) {
    case "dragCancel":
      return [{ kind: "dropDraft" }, { kind: "endInteraction" }];
    case "drag":
      return resolveMove(event.detail, ctx);
    case "edgeDrag":
      return resolveEdgeDrag(event.detail, ctx);
    case "rubberBand":
      return resolveRubberBand(event.detail, ctx);
    case "connection":
      return resolveConnection(event.detail, ctx);
    case "resize":
      return resolveResize(event.detail, ctx);
    case "rotate":
      return resolveRotate(event.detail, ctx);
    case "vertexDrag":
      return resolveVertexDrag(event.detail, ctx);
  }
}

function resolveMove(d: DragEvents["drag"], ctx: DragContext): DragEffect[] {
  const { dx, dy } = snapDelta(d.dx, d.dy, ctx.grid);
  // A lone waypoint reshapes its route orthogonally (inserting jogs) rather
  // than translating; anything else (components, multi-selection) is a
  // plain move.
  const only = d.keys.length === 1 ? d.keys[0] : undefined;
  const single = only ? parseKey(only) : null;
  if (single?.kind === "junction") {
    const moved = reshapeJunction(ctx.layout, single, dx, dy);
    return draftOrCommit(d.draft, moved, { kind: "moving", keys: d.keys });
  }
  const moved = applyDeltaMove(ctx.layout, d.keys, dx, dy);
  if (d.draft) {
    return draftOrCommit(true, moved, { kind: "moving", keys: d.keys });
  }
  // `snapDelta` only rounds the delta, so an entity that started off-grid
  // would stay off-grid after any move. This pass pulls the final extent
  // corners onto grid intersections, matching OMEdit's "Snap to Grid" on
  // mouse-up.
  return [
    { kind: "commit", layout: applySnapToExtents(moved, d.keys, ctx.grid) },
    { kind: "endInteraction" },
  ];
}

function resolveEdgeDrag(
  d: DragEvents["edgeDrag"],
  ctx: DragContext,
): DragEffect[] {
  const { dx, dy } = snapDelta(d.dx, d.dy, ctx.grid);
  const moved = applyEdgeSegmentDrag(
    withMaterialisedRoute(ctx.layout, d.connIdx),
    d.connIdx,
    d.grab,
    dx,
    dy,
  );
  return draftOrCommit(d.draft, moved, {
    kind: "moving",
    keys: [`edge:${d.connIdx}`],
  });
}

function resolveRubberBand(
  d: DragEvents["rubberBand"],
  ctx: DragContext,
): DragEffect[] {
  const keys = selectByDiagramRect(ctx.layout, d.rect);
  return d.draft
    ? [
        { kind: "selection", keys, emit: false },
        { kind: "state", state: { kind: "selecting" } },
      ]
    : [{ kind: "selection", keys, emit: true }, { kind: "endInteraction" }];
}

function resolveConnection(
  d: DragEvents["connection"],
  ctx: DragContext,
): DragEffect[] {
  if (!d.commit) {
    // `fromPoint` / `compat` are resolved by ConnectMode (which already
    // needs them to draw the wire) and ride on the event, so the host
    // doesn't re-walk the shadow DOM or re-run the compat check on every
    // pointermove.
    return [
      {
        kind: "connectionDrag",
        value: { from: d.from, toKey: d.toKey, compat: d.compat },
      },
      {
        kind: "state",
        state: { kind: "connecting", fromKey: d.from, toKey: d.toKey },
      },
    ];
  }
  const effects: DragEffect[] = [{ kind: "connectionDrag", value: null }];
  // Only create when we have a snap target AND the local check didn't
  // reject it. Incompatible drops silently fail — matches what the user
  // just saw (red wire) and avoids a round-trip to OMC for a connection we
  // know it would reject.
  if (d.toKey && (d.compat === null || d.compat.ok)) {
    const toPoint = ctx.connectorPosition(d.toKey);
    effects.push({
      kind: "connectionCreate",
      fromKey: d.from,
      toKey: d.toKey,
      waypoints: toPoint ? orthogonalRoute(d.fromPoint, toPoint) : [],
    });
  }
  effects.push({ kind: "endInteraction" });
  return effects;
}

function resolveResize(
  d: DragEvents["resize"],
  ctx: DragContext,
): DragEffect[] {
  const { x, y } = snapPoint(d.x, d.y, ctx.grid);
  const resized = applyResize(ctx.layout, d.key, d.corner, x, y);
  return draftOrCommit(d.draft, resized, {
    kind: "resizing",
    key: d.key,
    corner: d.corner,
  });
}

function resolveRotate(
  d: DragEvents["rotate"],
  ctx: DragContext,
): DragEffect[] {
  // The handle sits due north at 0°, so the angle is the pivot-to-pointer
  // bearing less a quarter turn.
  const pivot = shapeCentre(ctx.layout, d.key);
  if (!pivot) {
    return [];
  }
  // Rotate the live selection when the handle's owner is in it (the usual
  // case — the handle only shows on a selected shape), the handle's own
  // owner otherwise.
  const keys = ctx.selectedKeys.has(d.key) ? ctx.selectedKeys : [d.key];
  const raw = (Math.atan2(d.y - pivot[1], d.x - pivot[0]) * 180) / Math.PI - 90;
  const snap = d.free ? 0 : ctx.rotateSnapDegrees;
  const deg = snap > 0 ? Math.round(raw / snap) * snap : raw;
  const rotated = applyRotation(ctx.layout, keys, deg);
  return draftOrCommit(d.draft, rotated, { kind: "rotating", key: d.key });
}

function resolveVertexDrag(
  d: DragEvents["vertexDrag"],
  ctx: DragContext,
): DragEffect[] {
  const vertex = parseKey(d.key);
  if (!vertex || vertex.kind !== "vertex-handle") {
    return [];
  }
  const shapeKey = vertexShapeKey(vertex);
  const { x, y } = snapPoint(d.x, d.y, ctx.grid);
  const edited = applyShapeVertexDrag(
    ctx.layout,
    shapeKey,
    vertex.vertexIndex,
    x,
    y,
  );
  return draftOrCommit(d.draft, edited, { kind: "moving", keys: [shapeKey] });
}

/**
 * Reshape a connection's route around a dragged waypoint, keeping it
 * orthogonal. A malformed junction id leaves the layout untouched.
 */
function reshapeJunction(
  layout: DiagramLayout,
  junction: JunctionKey,
  dx: number,
  dy: number,
): DiagramLayout {
  const { connIndex, waypointIndex } = junction;
  if (Number.isNaN(connIndex) || Number.isNaN(waypointIndex)) {
    return layout;
  }
  return applyWaypointDrag(
    withMaterialisedRoute(layout, connIndex),
    connIndex,
    waypointIndex,
    dx,
    dy,
  );
}

/** The draft-vs-commit lifecycle every moving gesture shares: preview under
 *  the gesture's own interaction state, persist and stand down on release. */
function draftOrCommit(
  draft: boolean,
  layout: DiagramLayout,
  state: InteractionState,
): DragEffect[] {
  return draft
    ? [
        { kind: "draft", layout },
        { kind: "state", state },
      ]
    : [{ kind: "commit", layout }, { kind: "endInteraction" }];
}
