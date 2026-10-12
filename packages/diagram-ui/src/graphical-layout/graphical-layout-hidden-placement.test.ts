/**
 * `Placement(visible = false)` leaves an instance undrawn in both views while
 * the layout keeps it, so connections to it still anchor (issue #798).
 */

import { describe, expect, it } from "vitest";
import type { DiagramLayout, Extent, Placement } from "@dicode/omc-client";

import type { OmConnection } from "../connection/connection.component.js";
import type { OmConnector } from "../connector/connector.component.js";
import { mountLayout } from "../../test/harness/interaction-fixtures.js";
import {
  classDef,
  connectorLayout,
  emptyLayout,
  ICON_LAYERS,
} from "../../test/harness/layout-fixtures.js";

const extent: Extent = [
  [-10, -10],
  [10, 10],
];
const hiddenPlacement: Placement = { extent, visible: false };

/** A layout whose standalone connector `p` is hidden, plus its fixture
 *  connector for building siblings. */
function hiddenHostConnector(kind: DiagramLayout["kind"]): {
  layout: DiagramLayout;
  base: DiagramLayout;
} {
  const base = connectorLayout(kind, classDef());
  const conn = base.connectors["p"];
  if (conn === undefined) throw new Error("fixture lost p");
  return {
    base,
    layout: {
      ...base,
      connectors: { p: { ...conn, placement: hiddenPlacement } },
    },
  };
}

describe("<om-graphical-layout> Placement visible=false", () => {
  it.each(["diagram", "icon"] as const)(
    "draws no element for a host connector in the %s view",
    async (kind) => {
      const el = await mountLayout({
        layout: hiddenHostConnector(kind).layout,
      });
      expect(el.shadowRoot?.querySelectorAll("om-connector").length).toBe(0);
    },
  );

  it("draws no port on a component icon when the port is declared hidden", async () => {
    const port = (name: string, placement: Placement) => ({
      name,
      typeName: "Demo.Pin",
      placement,
      iconLayers: ICON_LAYERS,
      from: "Demo.Host",
    });
    const layout: DiagramLayout = {
      ...emptyLayout(),
      classes: {
        "Demo.Host": classDef({
          name: "Demo.Host",
          restriction: "model",
          connectors: {
            shown: port("shown", { extent }),
            gone: port("gone", hiddenPlacement),
          },
        }),
      },
      components: {
        c1: { name: "c1", classRef: "Demo.Host", placement: { extent } },
      },
    };
    const el = await mountLayout({ layout });
    const ids = Array.from(
      el.shadowRoot?.querySelectorAll<OmConnector>(
        "om-component om-connector",
      ) ?? [],
    ).map((c) => c.nodeId);
    expect(ids).toEqual(["shown"]);
  });

  it("still routes a connection to a hidden host connector's position", async () => {
    const { base, layout: hidden } = hiddenHostConnector("diagram");
    const conn = base.connectors["p"];
    if (conn === undefined) throw new Error("fixture lost p");
    const layout: DiagramLayout = {
      ...hidden,
      connectors: {
        ...hidden.connectors,
        q: {
          ...conn,
          name: "q",
          placement: {
            extent: [
              [90, -10],
              [110, 10],
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
    const el = await mountLayout({ layout });
    const wire = el.shadowRoot?.querySelector<OmConnection>("om-connection");
    expect(wire?.path[0]).toEqual([0, 0]);
  });
});
