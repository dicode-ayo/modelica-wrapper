import type {
  ConnectionEndpoint,
  ConnectionLayout,
  DiagramLayout,
  Point,
} from "@dicode/omc-client";

/**
 * Reference-tolerant content equality for waypoint arrays. After an OMC
 * roundtrip the layout payload is a fresh object tree so identical
 * paths arrive at the entities with new array identity — without this
 * check, edge / junction meshes would be disposed + rebuilt every
 * commit even when the geometry hasn't actually changed.
 */
export function pointsEqual(a: Point[] | null, b: Point[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = b[i]!;
    if (p[0] !== q[0] || p[1] !== q[1]) return false;
  }
  return true;
}

/**
 * Default routing for a freshly-created connection. Returns waypoints
 * (including both endpoints) forming an orthogonal "Z" between `from`
 * and `to`:
 *
 *   - aligned endpoints           → 2-point straight segment
 *   - longer horizontal distance  → split horizontally at the midpoint
 *   - longer vertical distance    → split vertically at the midpoint
 *
 * Tolerance for "aligned" is one diagram unit; coordinates that come
 * out of the picker round to integers via the icon coord system, so
 * anything tighter than that is effectively a coincidence.
 *
 * The route is deliberately simple — no obstacle avoidance, no port-
 * direction awareness. OMEdit ships the same default. Users can edit
 * waypoints after creation; this just gives a sensible start.
 */
export function orthogonalRoute(
  from: { x: number; y: number },
  to: { x: number; y: number },
): Point[] {
  const x1 = from.x;
  const y1 = from.y;
  const x2 = to.x;
  const y2 = to.y;
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const tol = 1;
  if (dx <= tol || dy <= tol) {
    return [
      [x1, y1],
      [x2, y2],
    ];
  }
  if (dx >= dy) {
    const midX = (x1 + x2) / 2;
    return [
      [x1, y1],
      [midX, y1],
      [midX, y2],
      [x2, y2],
    ];
  }
  const midY = (y1 + y2) / 2;
  return [
    [x1, y1],
    [x1, midY],
    [x2, midY],
    [x2, y2],
  ];
}

/**
 * Diagram-space centre of a connection endpoint, derived from the layout
 * data alone (no DOM query).
 *
 * For standalone host-class ports (`ep.component === undefined`) the
 * placement is already in diagram coordinates; for sub-component ports the
 * icon-space position is projected into the component's diagram-space frame
 * using the component's extent + rotation.
 *
 * Returns `null` when the endpoint can't be resolved (missing component,
 * missing class, missing port definition).
 */
export function endpointCentreFromLayout(
  layout: DiagramLayout,
  ep: ConnectionEndpoint,
): { x: number; y: number } | null {
  if (ep.component === undefined) {
    const conn = layout.connectors[ep.port];
    if (!conn) return null;
    const [[x1, y1], [x2, y2]] = conn.placement.extent;
    const ox = conn.placement.origin?.[0] ?? 0;
    const oy = conn.placement.origin?.[1] ?? 0;
    return { x: ox + (x1 + x2) / 2, y: oy + (y1 + y2) / 2 };
  }

  const comp = layout.components[ep.component];
  if (!comp) return null;
  const classDef = layout.classes[comp.classRef];
  if (!classDef) return null;
  const portDef = classDef.connectors[ep.port];
  if (!portDef) return null;

  const ce = comp.placement.extent;
  const cox = comp.placement.origin?.[0] ?? 0;
  const coy = comp.placement.origin?.[1] ?? 0;
  const compCx = cox + (ce[0][0] + ce[1][0]) / 2;
  const compCy = coy + (ce[0][1] + ce[1][1]) / 2;
  const compW = Math.abs(ce[1][0] - ce[0][0]) || 1;
  const compH = Math.abs(ce[1][1] - ce[0][1]) || 1;
  const compRot = ((comp.placement.rotation ?? 0) * Math.PI) / 180;

  const ics = classDef.coordinateSystem;
  const rawIconW = ics?.extent
    ? Math.abs((ics.extent[1]?.[0] ?? 100) - (ics.extent[0]?.[0] ?? -100))
    : 200;
  const rawIconH = ics?.extent
    ? Math.abs((ics.extent[1]?.[1] ?? 100) - (ics.extent[0]?.[1] ?? -100))
    : 200;
  const iconW = rawIconW || 200;
  const iconH = rawIconH || 200;

  const scaleX = compW / iconW;
  const scaleY = compH / iconH;

  const pe = portDef.placement.extent;
  const pox = portDef.placement.origin?.[0] ?? 0;
  const poy = portDef.placement.origin?.[1] ?? 0;
  const portIconX = pox + (pe[0][0] + pe[1][0]) / 2;
  const portIconY = poy + (pe[0][1] + pe[1][1]) / 2;

  const localX = portIconX * scaleX;
  const localY = portIconY * scaleY;
  const cosR = Math.cos(compRot);
  const sinR = Math.sin(compRot);

  return {
    x: compCx + localX * cosR - localY * sinR,
    y: compCy + localX * sinR + localY * cosR,
  };
}

/**
 * Resolves the path to render for a connection.
 *
 * When `conn.waypoints` has two or more points it is returned as-is.
 * When it is empty the two endpoint centres are computed from the layout
 * and an orthogonal route is generated. Returns an empty array only when
 * both endpoints can't be resolved.
 */
export function resolveConnectionWaypoints(
  layout: DiagramLayout,
  conn: ConnectionLayout,
): Point[] {
  if (conn.waypoints.length >= 2) {
    return conn.waypoints;
  }
  const from = endpointCentreFromLayout(layout, conn.lhs);
  const to = endpointCentreFromLayout(layout, conn.rhs);
  if (!from || !to) {
    return conn.waypoints;
  }
  return orthogonalRoute(from, to);
}
