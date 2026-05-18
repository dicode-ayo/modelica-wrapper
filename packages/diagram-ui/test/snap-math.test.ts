import { describe, expect, it } from "vitest";

import type {
  CoordinateSystem,
  DiagramLayout,
  Placement,
} from "@modelica-wrapper/omc-client";
import { applySnapToExtents } from "../src/interaction/layout-ops.js";
import {
  DEFAULT_SNAP_GRID,
  NO_SNAP,
  resolveSnapGrid,
  snapDelta,
  snapExtent,
  snapPlacement,
  snapPoint,
} from "../src/interaction/snap-math.js";
import { formatKey } from "../src/interaction/node-keys.js";

describe("resolveSnapGrid: priority order", () => {
  it("returns the OMEdit default when the annotation is empty", () => {
    expect(resolveSnapGrid(undefined)).toEqual(DEFAULT_SNAP_GRID);
    expect(resolveSnapGrid({})).toEqual(DEFAULT_SNAP_GRID);
  });

  it("uses coordinateSystem.grid when annotated", () => {
    const cs: CoordinateSystem = { grid: [5, 5] };
    expect(resolveSnapGrid(cs)).toEqual([5, 5]);
  });

  it("falls back to default when grid is malformed", () => {
    // Single-element or non-numeric arrays shouldn't crash the resolver.
    const cs: CoordinateSystem = { grid: [3] as unknown as number[] };
    expect(resolveSnapGrid(cs)).toEqual(DEFAULT_SNAP_GRID);
  });

  it("override wins over both annotation and default", () => {
    const cs: CoordinateSystem = { grid: [5, 5] };
    expect(resolveSnapGrid(cs, [10, 10])).toEqual([10, 10]);
  });

  it("override [0, 0] explicitly disables snapping", () => {
    const cs: CoordinateSystem = { grid: [5, 5] };
    expect(resolveSnapGrid(cs, NO_SNAP)).toEqual([0, 0]);
  });

  it("sanitises non-finite / negative components to zero", () => {
    // NaN, Infinity, and negative steps would all break snapScalar
    // math; the resolver replaces them with 0 (axis disabled).
    expect(resolveSnapGrid(undefined, [NaN, -3])).toEqual([0, 0]);
    expect(resolveSnapGrid(undefined, [Infinity, 4])).toEqual([0, 4]);
  });
});

describe("snapDelta: rounds to nearest grid step", () => {
  it("rounds to the nearest multiple in each axis", () => {
    // dx=3 → 3/2 = 1.5, Math.round(1.5)=2 → 4.
    // dy=-7 → -7/2 = -3.5, Math.round(-3.5)=-3 (JS rounds halves
    // toward +∞) → -6.
    expect(snapDelta(3, -7, [2, 2])).toEqual({ dx: 4, dy: -6 });
    expect(snapDelta(0.9, 1.1, [2, 2])).toEqual({ dx: 0, dy: 2 });
  });

  it("is a pass-through when both axes are zero (snap disabled)", () => {
    expect(snapDelta(3.14, -7.5, [0, 0])).toEqual({ dx: 3.14, dy: -7.5 });
  });

  it("preserves the value on the disabled axis only", () => {
    expect(snapDelta(3.14, 2.5, [0, 2])).toEqual({ dx: 3.14, dy: 2 });
  });

  it("never produces NaN even for non-finite inputs", () => {
    expect(snapDelta(NaN, 2, [2, 2])).toEqual({ dx: NaN, dy: 2 });
  });
});

describe("snapPoint: snaps to grid intersections", () => {
  it("rounds to the nearest grid corner", () => {
    expect(snapPoint(11.2, -3.1, [5, 5])).toEqual({ x: 10, y: -5 });
  });

  it("returns the input verbatim when snap is disabled", () => {
    expect(snapPoint(11.2, -3.1, NO_SNAP)).toEqual({ x: 11.2, y: -3.1 });
  });
});

describe("snapExtent: snaps both corners independently", () => {
  it("rounds each corner to the nearest grid point", () => {
    expect(snapExtent([
      [3, 7],
      [23, 27],
    ], [2, 2])).toEqual([
      [4, 8],
      [24, 28],
    ]);
  });

  it("respects per-axis grid steps (gx ≠ gy)", () => {
    expect(snapExtent([
      [1, 1],
      [9, 9],
    ], [5, 2])).toEqual([
      [0, 2],
      [10, 10],
    ]);
  });
});

describe("snapPlacement: returns the same reference when no-op", () => {
  it("preserves identity when extent + origin are already on-grid", () => {
    const p: Placement = { extent: [[0, 0], [20, 20]], origin: [10, 10] };
    expect(snapPlacement(p, [2, 2])).toBe(p);
  });

  it("snaps both extent and origin together", () => {
    const p: Placement = { extent: [[3, 7], [23, 27]], origin: [11, 11] };
    const out = snapPlacement(p, [2, 2]);
    expect(out).not.toBe(p);
    expect(out.extent).toEqual([
      [4, 8],
      [24, 28],
    ]);
    expect(out.origin).toEqual([12, 12]);
  });
});

describe("applySnapToExtents: drag-commit grid alignment", () => {
  // Minimal fake layout factory — enough fields to satisfy the schema
  // for the keys we exercise. Junctions, connections, classes etc. are
  // left empty; applySnapToExtents only walks components + connectors.
  function fakeLayout(
    components: Record<string, Placement>,
    connectors: Record<string, Placement> = {},
  ): DiagramLayout {
    return {
      components: Object.fromEntries(
        Object.entries(components).map(([id, placement]) => [
          id,
          { classRef: `Cls_${id}`, placement },
        ]),
      ),
      connectors: Object.fromEntries(
        Object.entries(connectors).map(([id, placement]) => [
          id,
          { classRef: `Cls_${id}`, placement },
        ]),
      ),
      classes: {},
      connections: [],
      labels: [],
    } as unknown as DiagramLayout;
  }

  it("pulls an off-grid component onto the grid", () => {
    // Regression: after a sub-step drag, snapDelta keeps the relative
    // offset, leaving the final extent off-grid. applySnapToExtents
    // (run on commit) must override that and produce a grid-aligned
    // value.
    const layout = fakeLayout({
      gain1: { extent: [[3, 7], [23, 27]] },
    });
    const out = applySnapToExtents(
      layout,
      [formatKey("component", "gain1")],
      [2, 2],
    );
    expect(out.components["gain1"]?.placement.extent).toEqual([
      [4, 8],
      [24, 28],
    ]);
  });

  it("returns the same layout reference when nothing changed", () => {
    // No-op snap should not break Lit's change detection by allocating
    // a fresh layout object for free.
    const layout = fakeLayout({
      onGrid: { extent: [[0, 0], [20, 20]] },
    });
    const out = applySnapToExtents(
      layout,
      [formatKey("component", "onGrid")],
      [2, 2],
    );
    expect(out).toBe(layout);
  });

  it("does nothing when grid is [0, 0] (snap disabled)", () => {
    const layout = fakeLayout({
      off: { extent: [[3, 7], [23, 27]] },
    });
    const out = applySnapToExtents(
      layout,
      [formatKey("component", "off")],
      [0, 0],
    );
    expect(out).toBe(layout);
  });

  it("ignores unknown keys without throwing", () => {
    const layout = fakeLayout({
      a: { extent: [[3, 7], [23, 27]] },
    });
    // `phantom` doesn't exist in components — the snap should still
    // apply to `a` and not crash on the missing entry.
    const out = applySnapToExtents(
      layout,
      [formatKey("component", "phantom"), formatKey("component", "a")],
      [2, 2],
    );
    expect(out.components["a"]?.placement.extent).toEqual([
      [4, 8],
      [24, 28],
    ]);
  });

  it("snaps standalone connectors too", () => {
    const layout = fakeLayout(
      {},
      { port1: { extent: [[1, 1], [11, 11]] } },
    );
    const out = applySnapToExtents(
      layout,
      [formatKey("connector", "port1")],
      [2, 2],
    );
    expect(out.connectors["port1"]?.placement.extent).toEqual([
      [2, 2],
      [12, 12],
    ]);
  });
});
