import type { DiagramLayout, Extent } from "@modelica-wrapper/omc-client";

/**
 * Diffs two `DiagramLayout` snapshots and emits a flat list of mutation
 * intents — the host then forwards each to the appropriate omc-client
 * call (see `apply-edits.ts`).
 *
 * Scope (v1):
 *   - component placement extent changes  → `componentPlacement`
 *   - component deletion                  → `componentDeleted`
 *   - connection deletion                 → `connectionDeleted`
 *   - new connection                      → `connectionAdded`
 *
 * Out of scope (deferred):
 *   - component class swaps
 *   - connector mutations (rare in practice)
 *   - waypoint refinements on existing connections (treated as
 *     no-ops; OMEdit doesn't push these back either)
 */
export type LayoutEdit =
  | {
      kind: "componentPlacement";
      componentName: string;
      componentClass: string;
      extent: Extent;
      rotation: number;
    }
  | {
      kind: "componentDeleted";
      componentName: string;
    }
  | {
      kind: "connectionAdded";
      from: string;
      to: string;
      waypoints: ReadonlyArray<readonly [number, number]>;
    }
  | {
      kind: "connectionDeleted";
      from: string;
      to: string;
    };

function endpointToCref(
  c: { component: string | undefined; port: string },
): string {
  return c.component ? `${c.component}.${c.port}` : c.port;
}

function extentEqual(a: Extent, b: Extent): boolean {
  return (
    a[0][0] === b[0][0] &&
    a[0][1] === b[0][1] &&
    a[1][0] === b[1][0] &&
    a[1][1] === b[1][1]
  );
}

export function diffLayouts(
  prev: DiagramLayout,
  next: DiagramLayout,
): LayoutEdit[] {
  const edits: LayoutEdit[] = [];

  // Components: detect placement changes + deletions. Additions are
  // deferred — adding a component from outside the diagram is its own
  // dragging gesture in a future stage.
  for (const [name, before] of Object.entries(prev.components)) {
    const after = next.components[name];
    if (!after) {
      edits.push({ kind: "componentDeleted", componentName: name });
      continue;
    }
    const placementChanged =
      !extentEqual(before.placement.extent, after.placement.extent) ||
      (before.placement.rotation ?? 0) !== (after.placement.rotation ?? 0);
    if (placementChanged) {
      edits.push({
        kind: "componentPlacement",
        componentName: name,
        componentClass: after.classRef,
        extent: after.placement.extent,
        rotation: after.placement.rotation ?? 0,
      });
    }
  }

  // Connections: index-based comparison. A connection is identified by
  // (lhs, rhs) endpoints; if a slot's endpoints change we treat it as
  // delete-old + add-new because OMC's `updateConnection` is missing
  // on 1.26.x.
  const prevConns = prev.connections.map((c) => ({
    from: endpointToCref(c.lhs),
    to: endpointToCref(c.rhs),
    waypoints: c.waypoints,
  }));
  const nextConns = next.connections.map((c) => ({
    from: endpointToCref(c.lhs),
    to: endpointToCref(c.rhs),
    waypoints: c.waypoints,
  }));
  const nextKey = new Set(nextConns.map((c) => `${c.from}|${c.to}`));
  const prevKey = new Set(prevConns.map((c) => `${c.from}|${c.to}`));
  for (const c of prevConns) {
    if (!nextKey.has(`${c.from}|${c.to}`)) {
      edits.push({ kind: "connectionDeleted", from: c.from, to: c.to });
    }
  }
  for (const c of nextConns) {
    if (!prevKey.has(`${c.from}|${c.to}`)) {
      edits.push({
        kind: "connectionAdded",
        from: c.from,
        to: c.to,
        waypoints: c.waypoints as ReadonlyArray<readonly [number, number]>,
      });
    }
  }

  return edits;
}

/** Builds a Modelica `Placement(...)` annotation string for `updateComponent`. */
export function placementAnnotation(extent: Extent, rotation: number): string {
  const [[x1, y1], [x2, y2]] = extent;
  const rot = rotation === 0 ? "" : `, rotation=${rotation}`;
  return `Placement(transformation(extent={{${x1},${y1}},{${x2},${y2}}}${rot}))`;
}

/** Builds a Modelica `Line(points={...})` annotation for `addConnection`. */
export function lineAnnotation(
  waypoints: ReadonlyArray<readonly [number, number]>,
): string {
  if (waypoints.length === 0) {
    return "";
  }
  const pts = waypoints.map(([x, y]) => `{${x},${y}}`).join(",");
  return `Line(points={${pts}})`;
}
