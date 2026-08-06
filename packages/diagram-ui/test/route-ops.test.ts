import { describe, expect, it } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import {
  applyEdgeSegmentDrag,
  applyWaypointDelete,
  applyWaypointDrag,
  applyWaypointInsert,
  withMaterialisedRoute,
} from "../src/interaction/route-ops.js";
import { baseLayout, withRoute } from "./harness/layout-fixtures.js";

/** The connection's waypoints after an op. */
function route(layout: DiagramLayout): number[][] {
  return layout.connections[0]?.waypoints ?? [];
}

describe("applyWaypointInsert", () => {
  it("inserts a waypoint on the segment nearest the click", () => {
    // Z-route. A click at (8, 4) projects onto the middle vertical
    // segment (x=5) at (5, 4), landing between waypoints[1] and [2].
    const base = withRoute([
      [0, 0],
      [5, 0],
      [5, 10],
      [10, 10],
    ]);
    const l = applyWaypointInsert(base, 0, { x: 8, y: 4 });
    expect(route(l)).toEqual([
      [0, 0],
      [5, 0],
      [5, 4],
      [5, 10],
      [10, 10],
    ]);
  });

  it("projects onto the first segment when the click is nearest to it", () => {
    // Click near the horizontal segment 0-1 (y=0): projects to (3, 0)
    // and lands between waypoints[0] and [1].
    const base = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    const l = applyWaypointInsert(base, 0, { x: 3, y: 1 });
    expect(route(l)).toEqual([
      [0, 0],
      [3, 0],
      [10, 0],
      [10, 10],
    ]);
  });

  it("clamps the projection to the segment endpoints", () => {
    // A click beyond the far end of a 2-point straight connection
    // projects onto the endpoint, not past it.
    const base = withRoute([
      [0, 0],
      [10, 0],
    ]);
    const l = applyWaypointInsert(base, 0, { x: 50, y: 0 });
    expect(route(l)).toEqual([
      [0, 0],
      [10, 0],
      [10, 0],
    ]);
  });

  it("returns the same reference for an unknown connection index", () => {
    const layout = baseLayout();
    expect(applyWaypointInsert(layout, 9, { x: 0, y: 0 })).toBe(layout);
  });
});

describe("applyWaypointDelete", () => {
  it("removes an internal waypoint", () => {
    const base = withRoute([
      [0, 0],
      [5, 0],
      [5, 10],
      [10, 10],
    ]);
    const l = applyWaypointDelete(base, 0, 1);
    expect(route(l)).toEqual([
      [0, 0],
      [5, 10],
      [10, 10],
    ]);
  });

  it("never removes the first endpoint", () => {
    const layout = withRoute([
      [0, 0],
      [5, 0],
      [10, 10],
    ]);
    expect(applyWaypointDelete(layout, 0, 0)).toBe(layout);
  });

  it("never removes the last endpoint", () => {
    const layout = withRoute([
      [0, 0],
      [5, 0],
      [10, 10],
    ]);
    expect(applyWaypointDelete(layout, 0, 2)).toBe(layout);
  });

  it("returns the same reference for an unknown connection index", () => {
    const layout = baseLayout();
    expect(applyWaypointDelete(layout, 9, 1)).toBe(layout);
  });
});

describe("applyEdgeSegmentDrag", () => {
  it("moves an interior horizontal segment vertically, ignoring the parallel delta", () => {
    // U-route: the middle segment (1-2) is horizontal at y=5. Dragging
    // it moves only in y; the dx is discarded (Manhattan).
    const base = withRoute([
      [0, 0],
      [0, 5],
      [10, 5],
      [10, 0],
    ]);
    const l = applyEdgeSegmentDrag(base, 0, { x: 5, y: 5 }, 4, 3);
    expect(route(l)).toEqual([
      [0, 0],
      [0, 8],
      [10, 8],
      [10, 0],
    ]);
  });

  it("inserts a jog so a dragged terminal segment leaves its anchor pinned", () => {
    // L-route. Segment 0-1 is horizontal and touches the anchored
    // endpoint (0,0). Dragging it down inserts a vertical jog at the
    // anchor instead of moving the anchor.
    const base = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    const l = applyEdgeSegmentDrag(base, 0, { x: 5, y: 0 }, 0, 4);
    expect(route(l)).toEqual([
      [0, 0],
      [0, 4],
      [10, 4],
      [10, 10],
    ]);
  });

  it("jogs both anchors when a straight wire is dragged sideways", () => {
    // A 2-point vertical wire: both endpoints are anchored. Dragging it
    // in x must keep both anchors and route around via two jogs.
    const base = withRoute([
      [0, 0],
      [0, 10],
    ]);
    const l = applyEdgeSegmentDrag(base, 0, { x: 0, y: 5 }, 5, 2);
    expect(route(l)).toEqual([
      [0, 0],
      [5, 0],
      [5, 10],
      [0, 10],
    ]);
  });

  it("collapses the coincident corner a drag can create", () => {
    // Dragging the L's bottom segment all the way up to the elbow's
    // height makes the corner waypoint coincide with the anchor; the
    // duplicate is dropped rather than left as a zero-length segment.
    const base = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    const l = applyEdgeSegmentDrag(base, 0, { x: 5, y: 0 }, 0, 10);
    expect(route(l)).toEqual([
      [0, 0],
      [0, 10],
      [10, 10],
    ]);
  });

  it("returns the same reference for a zero delta", () => {
    const layout = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(applyEdgeSegmentDrag(layout, 0, { x: 5, y: 0 }, 0, 0)).toBe(layout);
  });

  it("returns the same reference for an unknown connection index", () => {
    const layout = baseLayout();
    expect(applyEdgeSegmentDrag(layout, 9, { x: 0, y: 0 }, 3, 3)).toBe(layout);
  });

  it("returns the same reference when the grabbed segment is zero-length", () => {
    // Segment 0 ([5,5]→[5,5]) is coincident; grabbing at its position
    // selects it first (strict-< in closestSegmentIndex keeps the earliest tie).
    const layout = withRoute([
      [5, 5],
      [5, 5],
      [10, 5],
    ]);
    expect(applyEdgeSegmentDrag(layout, 0, { x: 5, y: 5 }, 3, 7)).toBe(layout);
  });
});

describe("applyWaypointDrag", () => {
  it("reshapes around a dragged elbow with orthogonal jogs", () => {
    // L-route; waypoint 1 is the elbow (10,0) between a horizontal and a
    // vertical segment. Dragging it diagonally keeps both segments
    // orthogonal by inserting a jog on each side of the moved corner.
    const base = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    const l = applyWaypointDrag(base, 0, 1, 5, 3);
    expect(route(l)).toEqual([
      [0, 0],
      [15, 0],
      [15, 3],
      [10, 3],
      [10, 10],
    ]);
  });

  it("keeps trailing waypoints when reshaping a mid-route corner", () => {
    const base = withRoute([
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 20],
    ]);
    const l = applyWaypointDrag(base, 0, 1, 3, 2);
    expect(route(l)).toEqual([
      [0, 0],
      [0, 12],
      [3, 12],
      [3, 10],
      [10, 10],
      [10, 20],
    ]);
  });

  it("collapses to the same reference when a corner slides along its own segment", () => {
    // Dragging the elbow purely along its horizontal segment can't move
    // it without detaching the fixed neighbour, so the orthogonal route
    // is unchanged.
    const layout = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(applyWaypointDrag(layout, 0, 1, 5, 0)).toBe(layout);
  });

  it("never reshapes an endpoint waypoint", () => {
    const layout = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(applyWaypointDrag(layout, 0, 0, 3, 3)).toBe(layout);
    expect(applyWaypointDrag(layout, 0, 2, 3, 3)).toBe(layout);
  });

  it("returns the same reference for a zero delta", () => {
    const layout = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(applyWaypointDrag(layout, 0, 1, 0, 0)).toBe(layout);
  });

  it("returns the same reference for an unknown connection index", () => {
    const layout = baseLayout();
    expect(applyWaypointDrag(layout, 9, 1, 3, 3)).toBe(layout);
  });
});

describe("withMaterialisedRoute", () => {
  /** `baseLayout()` with a second standalone connector and one unrouted
   *  connection between the two — both endpoints resolvable from the layout. */
  function unrouted(): DiagramLayout {
    const base = baseLayout();
    return {
      ...base,
      connectors: {
        ...base.connectors,
        q: {
          name: "q",
          classRef: "Pin",
          placement: {
            extent: [
              [46, 18],
              [50, 22],
            ],
          },
        },
      },
      connections: [
        {
          lhs: { component: undefined, port: "p" },
          rhs: { component: undefined, port: "q" },
          waypoints: [],
        },
      ],
    };
  }

  it("derives a route from the endpoint positions", () => {
    const l = withMaterialisedRoute(unrouted(), 0);
    expect(route(l)).toEqual([
      [-48, 0],
      [0, 0],
      [0, 20],
      [48, 20],
    ]);
  });

  it("returns the same reference when the connection already has a route", () => {
    const layout = baseLayout();
    expect(withMaterialisedRoute(layout, 0)).toBe(layout);
  });

  it("returns the same reference when an endpoint can't be resolved", () => {
    const layout = unrouted();
    const orphaned: DiagramLayout = {
      ...layout,
      connections: layout.connections.map((c) => ({
        ...c,
        rhs: { component: undefined, port: "missing" },
      })),
    };
    expect(withMaterialisedRoute(orphaned, 0)).toBe(orphaned);
  });

  it("returns the same reference for an unknown connection index", () => {
    const layout = unrouted();
    expect(withMaterialisedRoute(layout, 7)).toBe(layout);
  });
});
