/**
 * Rendering fallbacks for classes without drawable layers (issues #510 and
 * #516):
 *
 *  - a catalog class whose layers draw nothing gets the NoIcon placeholder
 *    on every render path (component, nested port, standalone connector) —
 *    substituted at the `.layers` binding, never written into the layout;
 *  - a standalone connector picks the connector class's diagram layers in
 *    a diagram-kind layout (falling back to its icon layers) and its icon
 *    layers in an icon-kind layout.
 */

import { describe, expect, it } from "vitest";
import type { ClassDef, DiagramLayout, IconLayer } from "@dicode/omc-client";

import type { OmShapeElement } from "../base/shape-element.js";
import { NO_ICON_LAYERS } from "../icon-provider/no-icon.js";
import type { OmGraphicalLayout } from "./graphical-layout.component.js";
import { mountLayout } from "../../test/harness/interaction-fixtures.js";
import { emptyLayout } from "../../test/harness/layout-fixtures.js";

const ICON_LAYERS: IconLayer[] = [
  {
    from: "Demo.Pin",
    shapes: [
      {
        kind: "polygon",
        points: [
          [-100, 100],
          [100, 0],
          [-100, -100],
        ],
      },
    ],
  },
];

const DIAGRAM_LAYERS: IconLayer[] = [
  {
    from: "Demo.Pin",
    shapes: [
      {
        kind: "rectangle",
        extent: [
          [-40, -40],
          [40, 40],
        ],
      },
    ],
  },
];

function classDef(overrides: Partial<ClassDef> = {}): ClassDef {
  return {
    name: "Demo.Pin",
    restriction: "connector",
    iconLayers: [],
    connectors: {},
    parameters: {},
    ...overrides,
  };
}

function connectorLayout(
  kind: DiagramLayout["kind"],
  cls: ClassDef,
): DiagramLayout {
  return {
    ...emptyLayout(),
    kind,
    classes: { [cls.name]: cls },
    connectors: {
      p: {
        name: "p",
        classRef: cls.name,
        placement: {
          extent: [
            [-10, -10],
            [10, 10],
          ],
        },
      },
    },
  };
}

function standaloneConnector(el: OmGraphicalLayout): OmShapeElement {
  const conns = Array.from(
    el.shadowRoot?.querySelectorAll("om-connector") ?? [],
  ).filter((c) => !c.closest("om-component"));
  const first = conns[0];
  if (first === undefined) throw new Error("no standalone om-connector");
  return first as OmShapeElement;
}

describe("<om-graphical-layout> NoIcon placeholder (issue #510)", () => {
  it("substitutes the placeholder for a component whose class draws nothing", async () => {
    const layout: DiagramLayout = {
      ...emptyLayout(),
      classes: { "Demo.Blank": classDef({ name: "Demo.Blank" }) },
      components: {
        c1: {
          name: "c1",
          classRef: "Demo.Blank",
          placement: {
            extent: [
              [-10, -10],
              [10, 10],
            ],
          },
        },
      },
    };
    const el = await mountLayout({ layout });
    const comp = el.shadowRoot?.querySelector("om-component") as OmShapeElement;
    expect(comp.layers).toBe(NO_ICON_LAYERS);
  });

  it("leaves a component with drawable layers untouched", async () => {
    const layout: DiagramLayout = {
      ...emptyLayout(),
      classes: {
        "Demo.Pin": classDef({ iconLayers: ICON_LAYERS }),
      },
      components: {
        c1: {
          name: "c1",
          classRef: "Demo.Pin",
          placement: {
            extent: [
              [-10, -10],
              [10, 10],
            ],
          },
        },
      },
    };
    const el = await mountLayout({ layout });
    const comp = el.shadowRoot?.querySelector("om-component") as OmShapeElement;
    expect(comp.layers).toBe(ICON_LAYERS);
  });

  it("substitutes the placeholder for a nested port whose class draws nothing", async () => {
    const portClass = classDef({ name: "Demo.BlankPin" });
    const hostClass = classDef({
      name: "Demo.Block",
      restriction: "block",
      iconLayers: ICON_LAYERS,
      connectors: {
        p: {
          name: "p",
          typeName: "Demo.BlankPin",
          placement: {
            extent: [
              [-110, -10],
              [-90, 10],
            ],
          },
          iconLayers: [],
          from: "Demo.Block",
        },
      },
    });
    const layout: DiagramLayout = {
      ...emptyLayout(),
      classes: { "Demo.Block": hostClass, "Demo.BlankPin": portClass },
      components: {
        c1: {
          name: "c1",
          classRef: "Demo.Block",
          placement: {
            extent: [
              [-10, -10],
              [10, 10],
            ],
          },
        },
      },
    };
    const el = await mountLayout({ layout });
    const port = el.shadowRoot?.querySelector(
      "om-component om-connector",
    ) as OmShapeElement;
    expect(port.layers).toBe(NO_ICON_LAYERS);
  });

  it("substitutes the placeholder for a standalone connector whose class draws nothing", async () => {
    const el = await mountLayout({
      layout: connectorLayout("diagram", classDef()),
    });
    expect(standaloneConnector(el).layers).toBe(NO_ICON_LAYERS);
  });

  it("never writes the placeholder into the layout itself", async () => {
    const layout = connectorLayout("diagram", classDef());
    const el = await mountLayout({ layout });
    expect(el.layout?.classes["Demo.Pin"]?.iconLayers).toEqual([]);
    expect(el.layout?.iconLayers).toEqual([]);
    expect(el.layout?.diagramLayers).toEqual([]);
  });
});

describe("<om-graphical-layout> standalone connector layer selection (issue #516)", () => {
  it("renders the connector class's diagram layers in a diagram-kind layout", async () => {
    const cls = classDef({
      iconLayers: ICON_LAYERS,
      diagramLayers: DIAGRAM_LAYERS,
    });
    const el = await mountLayout({ layout: connectorLayout("diagram", cls) });
    expect(standaloneConnector(el).layers).toBe(DIAGRAM_LAYERS);
  });

  it("falls back to icon layers when the class has no diagram layers", async () => {
    const cls = classDef({ iconLayers: ICON_LAYERS });
    const el = await mountLayout({ layout: connectorLayout("diagram", cls) });
    expect(standaloneConnector(el).layers).toBe(ICON_LAYERS);
  });

  it("falls back to icon layers when the diagram layers draw nothing", async () => {
    // The producer omits an undrawn `diagramLayers`, but the schema admits
    // an explicit empty set — it must not beat a drawable icon.
    const cls = classDef({ iconLayers: ICON_LAYERS, diagramLayers: [] });
    const el = await mountLayout({ layout: connectorLayout("diagram", cls) });
    expect(standaloneConnector(el).layers).toBe(ICON_LAYERS);
  });

  it("renders icon layers in an icon-kind layout even when diagram layers exist", async () => {
    const cls = classDef({
      iconLayers: ICON_LAYERS,
      diagramLayers: DIAGRAM_LAYERS,
    });
    const el = await mountLayout({ layout: connectorLayout("icon", cls) });
    expect(standaloneConnector(el).layers).toBe(ICON_LAYERS);
  });

  it("keeps nested ports on the icon layer in a diagram-kind layout", async () => {
    const portClass = classDef({
      iconLayers: ICON_LAYERS,
      diagramLayers: DIAGRAM_LAYERS,
    });
    const hostClass = classDef({
      name: "Demo.Block",
      restriction: "block",
      connectors: {
        p: {
          name: "p",
          typeName: "Demo.Pin",
          placement: {
            extent: [
              [-110, -10],
              [-90, 10],
            ],
          },
          iconLayers: ICON_LAYERS,
          from: "Demo.Block",
        },
      },
    });
    const layout: DiagramLayout = {
      ...emptyLayout(),
      classes: { "Demo.Block": hostClass, "Demo.Pin": portClass },
      components: {
        c1: {
          name: "c1",
          classRef: "Demo.Block",
          placement: {
            extent: [
              [-10, -10],
              [10, 10],
            ],
          },
        },
      },
    };
    const el = await mountLayout({ layout });
    const port = el.shadowRoot?.querySelector(
      "om-component om-connector",
    ) as OmShapeElement;
    expect(port.layers).toBe(ICON_LAYERS);
  });
});
