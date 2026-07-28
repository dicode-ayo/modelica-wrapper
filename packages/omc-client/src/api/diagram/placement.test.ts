import { describe, expect, it } from "vitest";
import type {
  ComponentElement,
  ComponentRef,
} from "../../_shared/modelInstance.js";

import {
  counterpartPlacementFor,
  flattenCref,
  placementFor,
} from "./placement.js";

function cref(
  parts: Array<{ name: string; subscripts?: unknown[] }>,
): ComponentRef {
  return { $kind: "cref", parts } as ComponentRef;
}

describe("flattenCref", () => {
  it("splits a bare two-part port into component + port", () => {
    expect(
      flattenCref(cref([{ name: "spring" }, { name: "flange_b" }])),
    ).toEqual({ component: "spring", port: "flange_b" });
  });

  it("keeps a host-class port's name with no component", () => {
    expect(flattenCref(cref([{ name: "u" }]))).toEqual({
      component: undefined,
      port: "u",
    });
  });

  it("preserves a subscript on the port part (kinematicPTP.y[1])", () => {
    // Regression: dropping the `[1]` makes `updateConnection` silently no-op,
    // so a moved block's re-routed waypoints never persist.
    expect(
      flattenCref(
        cref([{ name: "kinematicPTP" }, { name: "y", subscripts: [1] }]),
      ),
    ).toEqual({
      component: "kinematicPTP",
      port: "y",
      portSubscripts: "[1]",
    });
  });

  it("preserves a subscript on the component part (pins[3].p)", () => {
    expect(
      flattenCref(cref([{ name: "pins", subscripts: [3] }, { name: "p" }])),
    ).toEqual({
      component: "pins",
      port: "p",
      componentSubscripts: "[3]",
    });
  });

  it("preserves a subscript on a host-class port (y[1])", () => {
    expect(flattenCref(cref([{ name: "y", subscripts: [1] }]))).toEqual({
      component: undefined,
      port: "y",
      portSubscripts: "[1]",
    });
  });

  it("renders a multi-dimensional subscript", () => {
    expect(
      flattenCref(cref([{ name: "grid", subscripts: [2, 4] }, { name: "p" }])),
    ).toEqual({
      component: "grid",
      port: "p",
      componentSubscripts: "[2,4]",
    });
  });

  it("leaves subscript fields undefined when unsubscripted", () => {
    const ep = flattenCref(cref([{ name: "a" }, { name: "b" }]));
    expect(ep?.componentSubscripts).toBeUndefined();
    expect(ep?.portSubscripts).toBeUndefined();
  });

  it("drops the whole suffix when a subscript can't be rendered", () => {
    // A subscript `expressionToString` can't print would otherwise fabricate a
    // `"[]"` cref that silently misses on the updateConnection write path.
    const unprintable = { $kind: "range" } as unknown;
    expect(
      flattenCref(
        cref([{ name: "pins", subscripts: [unprintable] }, { name: "p" }]),
      )?.componentSubscripts,
    ).toBeUndefined();
  });

  it("returns undefined for a malformed (empty) cref", () => {
    expect(flattenCref(cref([]))).toBeUndefined();
  });
});

/** A component element carrying the given Placement transformations. */
function withPlacement(placement: Record<string, unknown>): ComponentElement {
  return {
    name: "p",
    type: { name: "Pin" },
    annotation: { Placement: placement },
  } as unknown as ComponentElement;
}

const DIAGRAM = {
  extent: [
    [-140, -20],
    [-100, 20],
  ],
};
const ICON = {
  extent: [
    [-110, -10],
    [-90, 10],
  ],
};

describe("placementFor", () => {
  it("prefers the view's own transformation and falls back to the other", () => {
    const both = withPlacement({
      transformation: DIAGRAM,
      iconTransformation: ICON,
    });
    expect(placementFor(both, "diagram")?.extent).toEqual(DIAGRAM.extent);
    expect(placementFor(both, "icon")?.extent).toEqual(ICON.extent);

    const onlyDiagram = withPlacement({ transformation: DIAGRAM });
    expect(placementFor(onlyDiagram, "icon")?.extent).toEqual(DIAGRAM.extent);
  });

  it("carries visible only when the annotation set it false", () => {
    const shown = withPlacement({ transformation: DIAGRAM });
    expect(placementFor(shown, "diagram")?.visible).toBeUndefined();

    const hidden = withPlacement({ transformation: DIAGRAM, visible: false });
    expect(placementFor(hidden, "diagram")?.visible).toBe(false);
  });
});

describe("counterpartPlacementFor", () => {
  it("reports the other view's transformation when both are defined", () => {
    const both = withPlacement({
      transformation: DIAGRAM,
      iconTransformation: ICON,
    });
    expect(counterpartPlacementFor(both, "icon")?.extent).toEqual(
      DIAGRAM.extent,
    );
    expect(counterpartPlacementFor(both, "diagram")?.extent).toEqual(
      ICON.extent,
    );
  });

  it("reports nothing when only one is defined", () => {
    // `placementFor` already fell back to it; naming it the counterpart would
    // write the same transformation under both keywords.
    const one = withPlacement({ transformation: DIAGRAM });
    expect(counterpartPlacementFor(one, "icon")).toBeUndefined();
    expect(counterpartPlacementFor(one, "diagram")).toBeUndefined();
  });

  it("reports nothing when the primary is present but undecodable", () => {
    // `placementFor` falls back to the other one, so it is not a counterpart.
    const bad = withPlacement({
      transformation: { extent: "nonsense" },
      iconTransformation: ICON,
    });
    expect(counterpartPlacementFor(bad, "diagram")).toBeUndefined();
  });
});
