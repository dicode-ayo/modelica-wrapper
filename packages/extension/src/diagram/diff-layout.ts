import type {
  DiagramLayout,
  Extent,
  IconLayer,
  Shape,
} from "@dicode/omc-client";

/** The two annotation layers a class carries graphics in. */
export type GraphicsLayer = "icon" | "diagram";

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
 *   - vector-port re-index rename         → `connectionRenamed`
 *     (a `connectorSizing` re-index shifts an indexed endpoint, e.g.
 *     `pins[3].p → pins[2].p`, while the other endpoint and the
 *     waypoints carry over; routed in-place via `updateConnectionNames`
 *     instead of the more-disruptive delete+add — see issue #26)
 *   - own-class icon/diagram shape add/modify/delete → `writeClassGraphics`
 *     (positional identity; see `diffGraphics` for the insert/delete caveat)
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
    }
  | {
      kind: "connectionRenamed";
      oldFrom: string;
      oldTo: string;
      newFrom: string;
      newTo: string;
      waypoints: ReadonlyArray<readonly [number, number]>;
    }
  | { kind: "graphicsAdded"; layer: GraphicsLayer; shape: Shape }
  | {
      kind: "graphicsModified";
      layer: GraphicsLayer;
      index: number;
      shape: Shape;
    }
  | { kind: "graphicsDeleted"; layer: GraphicsLayer; index: number };

function endpointToCref(c: {
  component: string | undefined;
  port: string;
}): string {
  return c.component ? `${c.component}.${c.port}` : c.port;
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
      !deepEqual(before.placement.extent, after.placement.extent) ||
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
  // change we generally treat it as delete-old + add-new — but FIRST we
  // try to recognise a `connectorSizing` vector-port re-index (issue
  // #26), which OMC can rewrite in place via `updateConnectionNames`
  // instead of the more-disruptive delete+add. If endpoints stay but
  // waypoints differ — typical of a component drag that drags adjacent
  // routes with it — we emit `connectionWaypoints`, which
  // `apply-edits.ts` translates to a single `updateConnection` call.
  // Without that edit the move's locally-re-routed waypoints never make
  // it to OMC; the post-edit re-fetch then reads the stale
  // `Line(points=...)` and the connections snap back to their old shape,
  // visually detached from the now-moved component.
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

  // Endpoint keys that have already been claimed by a `connectionRenamed`
  // collapse, so the delete/add loops below skip them.
  const consumedPrev = new Set<string>();
  const consumedNext = new Set<string>();

  // First pass: collapse vector-port re-index rename pairs. A re-index
  // shows up as one disappeared connection (`before`) and one appeared
  // connection (`after`) where exactly one endpoint differs, the other
  // is byte-identical, the changed endpoints differ ONLY in their vector
  // index (same component / port base, e.g. `pins[3].p` → `pins[2].p`),
  // and the waypoints carry over unchanged. See `isReindexRename`.
  //
  // A naive greedy nested loop mis-pairs a *cascade* shift (issue #76,
  // item 7): for `pins[1].p,pins[2].p → pins[2].p,pins[3].p` both the
  // 1→2 and 1→3 candidates look like valid re-indexes, so first-match can
  // pair `pins[1].p→pins[3].p` and drop the `pins[2].p` move, producing a
  // bogus rename that collides on replay. The index that "survived" (2)
  // actually changed its logical identity, which the diff alone can't
  // disambiguate.
  //
  // Safe rule: a re-index is only collapsed in place when the affected
  // vector base carries EXACTLY ONE connection in prev and EXACTLY ONE in
  // next (a lone vector-port re-index). When a base has more than one
  // connection on either side — a cascade or a swap — we leave the whole
  // group to the delete+add loops below, which are always correct.
  //
  // The base is keyed per (side, base, fixed-endpoint) signature so a
  // re-index on the from-side never mixes with one on the to-side, and two
  // re-indexes wired to different fixed endpoints stay independent.

  interface ReindexGroup {
    prev: Conn[];
    next: Conn[];
  }
  const groups = new Map<string, ReindexGroup>();
  const groupKeyForConn = (c: Conn): string[] => keysForReindexGroups(c);
  for (const c of prevConns) {
    for (const sig of groupKeyForConn(c)) {
      let g = groups.get(sig);
      if (!g) groups.set(sig, (g = { prev: [], next: [] }));
      g.prev.push(c);
    }
  }
  for (const c of nextConns) {
    for (const sig of groupKeyForConn(c)) {
      let g = groups.get(sig);
      if (!g) groups.set(sig, (g = { prev: [], next: [] }));
      g.next.push(c);
    }
  }
  for (const g of groups.values()) {
    // Only a lone 1:1 re-index on the base is safe to rewrite in place.
    if (g.prev.length !== 1 || g.next.length !== 1) continue;
    const before = g.prev[0]!;
    const after = g.next[0]!;
    const beforeKey = `${before.from}|${before.to}`;
    const afterKey = `${after.from}|${after.to}`;
    // Unchanged connection (survived verbatim) — nothing to rename.
    if (beforeKey === afterKey) continue;
    if (consumedPrev.has(beforeKey) || consumedNext.has(afterKey)) continue;
    if (!isReindexRename(before, after)) continue;
    edits.push({
      kind: "connectionRenamed",
      oldFrom: before.from,
      oldTo: before.to,
      newFrom: after.from,
      newTo: after.to,
      waypoints: after.waypoints as ReadonlyArray<readonly [number, number]>,
    });
    consumedPrev.add(beforeKey);
    consumedNext.add(afterKey);
  }

  for (const c of prevConns) {
    const key = `${c.from}|${c.to}`;
    if (consumedPrev.has(key)) continue;
    if (!nextByKey.has(key)) {
      edits.push({ kind: "connectionDeleted", from: c.from, to: c.to });
    }
  }
  for (const c of nextConns) {
    const key = `${c.from}|${c.to}`;
    if (consumedNext.has(key)) continue;
    const before = prevByKey.get(key);
    if (!before) {
      edits.push({
        kind: "connectionAdded",
        from: c.from,
        to: c.to,
        waypoints: c.waypoints as ReadonlyArray<readonly [number, number]>,
      });
    } else if (!deepEqual(before.waypoints, c.waypoints)) {
      edits.push({
        kind: "connectionWaypoints",
        from: c.from,
        to: c.to,
        waypoints: c.waypoints as ReadonlyArray<readonly [number, number]>,
      });
    }
  }

  diffGraphics(prev, next, edits);

  return edits;
}

/** Shapes in `layers` that the named class itself contributed, or `[]`. */
function ownShapes(
  layers: ReadonlyArray<IconLayer>,
  className: string,
): Shape[] {
  return layers.find((l) => l.from === className)?.shapes ?? [];
}

/**
 * Order-independent, undefined-tolerant JSON of a value: object keys are
 * sorted and `undefined`-valued keys dropped (matching JSON semantics). Two
 * values whose optional fields are present-as-undefined vs absent, or whose
 * object keys differ only in order, compare equal — so a re-fetch never
 * reports a spurious modify for a shape the user didn't touch.
 */
function stableJson(v: unknown): string {
  // JSON.stringify collapses NaN/Infinity to "null"; keep them distinct so a
  // non-finite-valued field never compares equal to an actual null.
  if (typeof v === "number" && !Number.isFinite(v)) return `n:${String(v)}`;
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, val]) => `${JSON.stringify(k)}:${stableJson(val)}`);
  return `{${entries.join(",")}}`;
}

/** Single deep-equal used for all leaf comparisons in the diff. */
function deepEqual(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

/**
 * LCS index pairs for two arrays under a caller-supplied equality predicate.
 * Returns `[(aIdx, bIdx), ...]` in ascending order — the longest subsequence
 * of `a` and `b` whose paired elements are equal.
 */
function lcsIndices<T>(
  a: T[],
  b: T[],
  eq: (x: T, y: T) => boolean,
): Array<[number, number]> {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const ai = a[i - 1];
      const bj = b[j - 1];
      if (ai !== undefined && bj !== undefined && eq(ai, bj)) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const ai = a[i - 1];
    const bj = b[j - 1];
    if (ai !== undefined && bj !== undefined && eq(ai, bj)) {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if ((dp[i - 1]![j] ?? 0) >= (dp[i]![j - 1] ?? 0)) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return pairs.reverse();
}

/**
 * Returns true when every shape in `after` appears in `before` by value
 * (via `deepEqual`), consuming one copy per match. A pure deletion means
 * the user removed shapes without modifying any survivors — the LCS-based
 * path can then emit minimal `graphicsDeleted` ops without risk of
 * accidentally dropping an in-place modify.
 */
function isPureDeletion(before: Shape[], after: Shape[]): boolean {
  const counts = new Map<string, number>();
  for (const s of before) {
    const k = stableJson(s);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const s of after) {
    const k = stableJson(s);
    const n = counts.get(k) ?? 0;
    if (n === 0) return false;
    counts.set(k, n - 1);
  }
  return true;
}

/**
 * Diff the host's OWN icon/diagram shapes (never inherited ancestor layers —
 * the write targets only `className`'s annotation).
 *
 * Two strategies are applied depending on the change shape:
 *
 * - **Same length or growth**: positional scan — a same-index value change is
 *   a modify, trailing extras are appends. This is optimal for the common
 *   "move/resize a shape" gesture (in-place edit = 1 op vs 2 for delete+add).
 *
 * - **Pure deletion** (shrunk, all surviving shapes exist in `before` by
 *   value): LCS-based minimal deletes. A non-contiguous multi-delete such as
 *   removing indices 1 and 3 from [A,B,C,D] produces two `graphicsDeleted`
 *   ops rather than a modify + two deletes. Deletes are emitted in descending
 *   index so `apply-edits` can run them without re-indexing.
 *
 * - **Mixed delete+modify** (shrunk, some `after` shapes are new values):
 *   positional fallback — shared prefix is scanned for modifies, then
 *   trailing slots are deleted. Always correct; produces fewer ops than
 *   delete+add for in-place edits.
 */
function diffGraphics(
  prev: DiagramLayout,
  next: DiagramLayout,
  edits: LayoutEdit[],
): void {
  const layers: ReadonlyArray<[GraphicsLayer, "iconLayers" | "diagramLayers"]> =
    [
      ["icon", "iconLayers"],
      ["diagram", "diagramLayers"],
    ];
  for (const [layer, field] of layers) {
    const before = ownShapes(prev[field], prev.className);
    const after = ownShapes(next[field], next.className);

    if (before.length <= after.length) {
      // Same length or growth: positional modifies + appends.
      const common = before.length;
      for (let i = 0; i < common; i += 1) {
        const a = before[i];
        const b = after[i];
        if (a !== undefined && b !== undefined && !deepEqual(a, b)) {
          edits.push({ kind: "graphicsModified", layer, index: i, shape: b });
        }
      }
      for (let i = before.length; i < after.length; i += 1) {
        const shape = after[i];
        if (shape !== undefined) {
          edits.push({ kind: "graphicsAdded", layer, shape });
        }
      }
      continue;
    }

    // Shrunk. Use LCS for pure deletions; fall back to positional otherwise.
    if (isPureDeletion(before, after)) {
      const pairs = lcsIndices(
        before,
        after,
        deepEqual as (x: Shape, y: Shape) => boolean,
      );
      const matchedBefore = new Set(pairs.map(([bi]) => bi));
      // Emit deletes in descending order so earlier removals don't shift later indices.
      for (let i = before.length - 1; i >= 0; i -= 1) {
        if (!matchedBefore.has(i)) {
          edits.push({ kind: "graphicsDeleted", layer, index: i });
        }
      }
    } else {
      // Mixed delete+modify: positional fallback.
      const common = after.length;
      for (let i = 0; i < common; i += 1) {
        const a = before[i];
        const b = after[i];
        if (a !== undefined && b !== undefined && !deepEqual(a, b)) {
          edits.push({ kind: "graphicsModified", layer, index: i, shape: b });
        }
      }
      for (let i = before.length - 1; i >= after.length; i -= 1) {
        edits.push({ kind: "graphicsDeleted", layer, index: i });
      }
    }
  }
}

/** A connection endpoint reference reduced to its diffable parts. */
interface Conn {
  from: string;
  to: string;
  waypoints: ReadonlyArray<readonly [number, number]>;
}

/**
 * Split a connector cref into `{ base, index }` where `base` is the cref
 * with its FIRST vector subscript removed and `index` is the subscript
 * text. `pins[3].p` → `{ base: "pins.p", index: "3" }`; an unsubscripted
 * cref → `{ base: cref, index: undefined }`.
 *
 * Only the first `[...]` is stripped — a `connectorSizing` re-index moves
 * exactly one vector dimension (the component instance index), and
 * collapsing only that one keeps the heuristic from matching unrelated
 * multi-dimensional crefs.
 */
function splitVectorIndex(cref: string): { base: string; index?: string } {
  const m = /^([^[]*)\[([^\]]*)\](.*)$/.exec(cref);
  if (!m) return { base: cref };
  return { base: `${m[1]}${m[3]}`, index: m[2] ?? "" };
}

/**
 * True iff (`before` → `after`) is the clear `connectorSizing` vector-port
 * re-index pattern that `updateConnectionNames` should handle in place,
 * rather than a coincidental delete+add.
 *
 * Conservative by design (issue #26): we only return true when
 *   1. exactly ONE endpoint changed and the other is byte-identical, AND
 *   2. the changed endpoints share the same base (component + port) and
 *      differ only in a vector subscript (e.g. `pins[3].p` vs `pins[2].p`,
 *      both reducing to base `pins.p`), AND
 *   3. the waypoints carried over unchanged — i.e. it's the same logical
 *      edge, just re-indexed, not a re-drawn wire.
 * Anything that doesn't fit all three falls through to the existing
 * delete+add behaviour.
 */
function isReindexRename(before: Conn, after: Conn): boolean {
  if (!deepEqual(before.waypoints, after.waypoints)) return false;

  const fromChanged = before.from !== after.from;
  const toChanged = before.to !== after.to;
  // Exactly one endpoint must differ; the other must persist verbatim.
  if (fromChanged === toChanged) return false;

  const oldEp = fromChanged ? before.from : before.to;
  const newEp = fromChanged ? after.from : after.to;
  return isReindexOf(oldEp, newEp);
}

/**
 * Re-index group signatures a connection belongs to (issue #76, item 7).
 *
 * A connection is a member of a group for each endpoint that carries a
 * vector subscript: `from`-side membership is keyed by the from-endpoint's
 * base plus the (fixed) to-endpoint; `to`-side by the to-endpoint's base
 * plus the (fixed) from-endpoint. Grouping this way lets the caller count
 * how many connections share a vector base wired to the same fixed end —
 * the signal that distinguishes a lone re-index (collapse) from a cascade /
 * swap (delete+add). A connection with no subscripted endpoint joins no
 * group and is handled by the plain delete/add/waypoint loops.
 */
function keysForReindexGroups(c: Conn): string[] {
  const keys: string[] = [];
  const fromSplit = splitVectorIndex(c.from);
  if (fromSplit.index !== undefined) {
    keys.push(`from|${fromSplit.base}|${c.to}`);
  }
  const toSplit = splitVectorIndex(c.to);
  if (toSplit.index !== undefined) {
    keys.push(`to|${toSplit.base}|${c.from}`);
  }
  return keys;
}

/**
 * True iff `a` and `b` are the same connector cref differing only in a
 * single vector subscript (and both actually carry one). Guards against
 * the degenerate "no subscript at all" case where both bases trivially
 * match.
 */
function isReindexOf(a: string, b: string): boolean {
  const sa = splitVectorIndex(a);
  const sb = splitVectorIndex(b);
  if (sa.index === undefined || sb.index === undefined) return false;
  if (sa.index === sb.index) return false; // identical index ⇒ not a re-index
  return sa.base === sb.base;
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
