import { describe, expect, it } from "vitest";
import type { ComponentRef } from "../../_shared/modelInstance.js";

import { flattenCref } from "./placement.js";

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
      componentSubscripts: "[2, 4]",
    });
  });

  it("omits subscript fields entirely when unsubscripted", () => {
    const ep = flattenCref(cref([{ name: "a" }, { name: "b" }]));
    expect(ep).not.toHaveProperty("componentSubscripts");
    expect(ep).not.toHaveProperty("portSubscripts");
  });

  it("returns undefined for a malformed (empty) cref", () => {
    expect(flattenCref(cref([]))).toBeUndefined();
  });
});
