/**
 * `Smooth.Bezier` on a `connect()` reaches the canvas: `<om-graphical-layout>`
 * forwards a connection's `smooth` to `<om-edge>`, which strokes and picks the
 * flattened curve. The geometry itself is pinned in `@dicode/diagram-svg` and
 * the component wiring in `edge.test.ts`; these pin the layout end of it.
 */
import { describe, expect, it } from "vitest";
import type { DiagramLayout, Point } from "@dicode/omc-client";

import type { OmConnection } from "../src/connection/connection.component.js";
import {
  graphicsWithLabel,
  mountLayout,
} from "./harness/interaction-fixtures.js";
import { withRoute } from "./harness/layout-fixtures.js";
import { pathVertices } from "./pixi-dash.helper.js";

/** A right-angle route whose corner (50, 0) a Bezier rounds away from. */
const CORNER_ROUTE: Point[] = [
  [0, 0],
  [50, 0],
  [50, 30],
];

function curvedRoute(): DiagramLayout {
  const base = withRoute(CORNER_ROUTE);
  return {
    ...base,
    connections: base.connections.map((c) => ({ ...c, smooth: "Bezier" })),
  };
}

describe("connection Smooth.Bezier", () => {
  it("strokes the waypoints verbatim without smoothing", async () => {
    const el = await mountLayout({ layout: withRoute(CORNER_ROUTE) });
    expect(pathVertices(graphicsWithLabel(el, "om-edge:0"))).toEqual(
      CORNER_ROUTE,
    );
  });

  it("curves the route while its junctions stay on the waypoints", async () => {
    // A Bezier is pulled toward each waypoint without reaching it, so the
    // discs mark grabbable corners the stroke no longer passes through.
    // That separation is deliberate: the waypoints remain the editable route.
    const el = await mountLayout({ layout: curvedRoute() });
    const drawn = pathVertices(graphicsWithLabel(el, "om-edge:0"));
    expect(drawn.length).toBeGreaterThan(CORNER_ROUTE.length);
    expect(drawn).not.toContainEqual([50, 0]);

    const conn = el.shadowRoot?.querySelector<OmConnection>("om-connection");
    if (!conn) throw new Error("expected an om-connection");
    const [disc] = conn.junctions;
    if (disc === undefined) throw new Error("expected a junction disc");
    expect([disc.position.x, disc.position.y]).toEqual([50, 0]);
  });
});
