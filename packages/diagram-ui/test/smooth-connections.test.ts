/**
 * `Smooth.Bezier` on a `connect()` reaches the canvas: `<om-graphical-layout>`
 * forwards a connection's `smooth` to `<om-edge>`, which strokes and picks the
 * flattened curve. The geometry itself is pinned in `@dicode/diagram-svg` and
 * the component wiring in `edge.test.ts`; this pins the layout end of it.
 */
import { describe, expect, it } from "vitest";
import type { Point } from "@dicode/omc-client";

import type { OmConnection } from "../src/connection/connection.component.js";
import {
  graphicsWithLabel,
  mountLayout,
} from "./harness/interaction-fixtures.js";
import { withRoute } from "./harness/layout-fixtures.js";
import { pathVertices } from "./pixi-dash.helper.js";

/** A right-angle route: two straight runs meeting at the corner (50, 0). */
const CORNER_ROUTE: Point[] = [
  [0, 0],
  [50, 0],
  [50, 30],
];

describe("connection Smooth.Bezier", () => {
  it("curves the route on a layout swap while its junction stays on the waypoint", async () => {
    const el = await mountLayout({ layout: withRoute(CORNER_ROUTE) });
    expect(pathVertices(graphicsWithLabel(el, "om-edge:0"))).toEqual(
      CORNER_ROUTE,
    );

    el.layout = withRoute(CORNER_ROUTE, { smooth: "Bezier" });
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));

    expect(pathVertices(graphicsWithLabel(el, "om-edge:0"))).not.toContainEqual(
      [50, 0],
    );
    const conn = el.shadowRoot?.querySelector<OmConnection>("om-connection");
    if (!conn) throw new Error("expected an om-connection");
    const [disc] = conn.junctions;
    if (disc === undefined) throw new Error("expected a junction disc");
    expect([disc.position.x, disc.position.y]).toEqual([50, 0]);
  });

  it("routes a two-waypoint connection straight even under Smooth.Bezier", async () => {
    // Two points cannot describe a curve; the route must not gain vertices.
    const direct: Point[] = [
      [0, 0],
      [50, 0],
    ];
    const el = await mountLayout({
      layout: withRoute(direct, { smooth: "Bezier" }),
    });
    expect(pathVertices(graphicsWithLabel(el, "om-edge:0"))).toEqual(direct);
  });
});
