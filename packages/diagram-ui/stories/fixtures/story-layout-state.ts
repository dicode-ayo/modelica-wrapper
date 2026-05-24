/**
 * Storybook-only glue that closes the loop between
 * `<om-graphical-layout>` and a mutable in-memory `DiagramLayout`. In
 * production this round-trip lives in the VSCode extension (event →
 * `addConnection` RPC → OMC re-fetch → push new layout). Here we just
 * append directly so the visual story is end-to-end usable without
 * spinning up an extension host.
 */

import type {
  ConnectionEndpoint,
  DiagramLayout,
  Point,
} from "@dicode/omc-client";

/**
 * Parse a connector key (`k:p` for standalone, `k:R1.p` for nested)
 * into the `{component, port}` shape that `ConnectionLayout` expects.
 * Returns `null` for malformed input — caller decides whether to skip
 * the event or surface an error.
 */
export function endpointFromKey(key: string): ConnectionEndpoint | null {
  const idx = key.indexOf(":");
  if (idx < 0 || key.slice(0, idx) !== "k") {
    return null;
  }
  const id = key.slice(idx + 1);
  const dot = id.indexOf(".");
  if (dot < 0) {
    return { component: undefined, port: id };
  }
  return { component: id.slice(0, dot), port: id.slice(dot + 1) };
}

/**
 * Append a freshly-created connection to a layout and return the
 * new layout. Returns the original if either endpoint can't be
 * parsed — keeps the story render side-effect-free.
 */
export function appendConnection(
  layout: DiagramLayout,
  detail: {
    fromKey: string;
    toKey: string;
    waypoints: ReadonlyArray<readonly [number, number]>;
  },
): DiagramLayout {
  const lhs = endpointFromKey(detail.fromKey);
  const rhs = endpointFromKey(detail.toKey);
  if (!lhs || !rhs) {
    return layout;
  }
  const waypoints: Point[] = detail.waypoints.map(
    ([x, y]) => [x, y] as Point,
  );
  return {
    ...layout,
    connections: [...layout.connections, { lhs, rhs, waypoints }],
  };
}
