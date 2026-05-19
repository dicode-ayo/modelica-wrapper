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
 *   - waypoint changes on existing connection → `connectionWaypoints`
 *     (needed so a component drag's locally-re-routed connections
 *     don't snap back to their old shape after the OMC round-trip)
 *
 * Out of scope (deferred):
 *   - component class swaps
 *   - connector mutations (rare in practice)
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
    }
  | {
      kind: "connectionWaypoints";
      from: string;
      to: string;
      waypoints: ReadonlyArray<readonly [number, number]>;
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

  // Connections: keyed by (lhs, rhs) endpoints. If a slot's endpoints
  // change we treat it as delete-old + add-new (OMC has no rename-edge
  // API). If endpoints stay but waypoints differ — typical of a
  // component drag that drags adjacent routes with it — we emit
  // `connectionWaypoints`, which `apply-edits.ts` translates to a
  // single `updateConnection` call. Without that edit the move's
  // locally-re-routed waypoints never make it to OMC; the post-edit
  // re-fetch then reads the stale `Line(points=...)` and the
  // connections snap back to their old shape, visually detached from
  // the now-moved component.
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
  const prevByKey = new Map(prevConns.map((c) => [`${c.from}|${c.to}`, c]));
  const nextByKey = new Map(nextConns.map((c) => [`${c.from}|${c.to}`, c]));
  for (const c of prevConns) {
    if (!nextByKey.has(`${c.from}|${c.to}`)) {
      edits.push({ kind: "connectionDeleted", from: c.from, to: c.to });
    }
  }
  for (const c of nextConns) {
    const before = prevByKey.get(`${c.from}|${c.to}`);
    if (!before) {
      edits.push({
        kind: "connectionAdded",
        from: c.from,
        to: c.to,
        waypoints: c.waypoints as ReadonlyArray<readonly [number, number]>,
      });
    } else if (!waypointsEqual(before.waypoints, c.waypoints)) {
      edits.push({
        kind: "connectionWaypoints",
        from: c.from,
        to: c.to,
        waypoints: c.waypoints as ReadonlyArray<readonly [number, number]>,
      });
    }
  }

  return edits;
}

function waypointsEqual(
  a: ReadonlyArray<readonly [number, number]>,
  b: ReadonlyArray<readonly [number, number]>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]![0] !== b[i]![0] || a[i]![1] !== b[i]![1]) return false;
  }
  return true;
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
