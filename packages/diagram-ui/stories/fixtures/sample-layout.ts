/**
 * Synthetic `DiagramLayout` used by `GraphicalLayout.stories.ts`. We
 * compose it client-side rather than capturing against OMC because
 * this is a UI-level demo — the icon shapes come from the real OMC
 * capture (`*.icon.json`), the layout is hand-authored.
 */

import type {
  ClassDef,
  DiagramLayout,
  IconLayer,
} from "@modelica-wrapper/omc-client";

import gainFixture from "./gain.icon.json";
import inertiaFixture from "./inertia.icon.json";
import springdamperFixture from "./springdamper.icon.json";

interface IconFixture {
  className: string;
  iconLayers: IconLayer[];
  coordinateSystem?: unknown;
}

const PIN_LAYERS: IconLayer[] = [
  {
    from: "Modelica.Electrical.Analog.Interfaces.Pin",
    shapes: [
      {
        kind: "rectangle",
        extent: [
          [-100, -100],
          [100, 100],
        ],
        lineColor: [0, 0, 127],
        fillColor: [0, 127, 255],
        pattern: "Solid",
        fillPattern: "Solid",
        lineThickness: 0.5,
      },
    ],
  },
];

function makeClass(
  fixture: IconFixture,
  ports: ClassDef["connectors"] = {},
  parameters: ClassDef["parameters"] = {},
): ClassDef {
  return {
    name: fixture.className,
    restriction: "block",
    iconLayers: fixture.iconLayers,
    coordinateSystem: fixture.coordinateSystem as ClassDef["coordinateSystem"],
    connectors: ports,
    parameters,
  };
}

const PIN_CLASS: ClassDef = {
  name: "Modelica.Electrical.Analog.Interfaces.Pin",
  restriction: "connector",
  iconLayers: PIN_LAYERS,
  connectors: {},
  parameters: {},
};

export function sampleLayout(): DiagramLayout {
  const gain = makeClass(gainFixture as IconFixture, {
    u: {
      name: "u",
      typeName: "Modelica.Electrical.Analog.Interfaces.Pin",
      placement: { extent: [[-110, -10], [-90, 10]] },
      iconLayers: PIN_LAYERS,
      from: "Modelica.Blocks.Math.Gain",
    },
    y: {
      name: "y",
      typeName: "Modelica.Electrical.Analog.Interfaces.Pin",
      placement: { extent: [[90, -10], [110, 10]] },
      iconLayers: PIN_LAYERS,
      from: "Modelica.Blocks.Math.Gain",
    },
  });

  const inertia = makeClass(inertiaFixture as IconFixture);
  const springdamper = makeClass(springdamperFixture as IconFixture);

  return {
    kind: "diagram",
    className: "Demo.Mechanics",
    source: { file: "Demo.mo", line: 1, column: 1 } as never,
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {
      "Modelica.Blocks.Math.Gain": gain,
      "Modelica.Mechanics.Rotational.Components.Inertia": inertia,
      "Modelica.Mechanics.Rotational.Components.SpringDamper": springdamper,
      "Modelica.Electrical.Analog.Interfaces.Pin": PIN_CLASS,
    },
    components: {
      gain1: {
        name: "gain1",
        classRef: "Modelica.Blocks.Math.Gain",
        placement: { extent: [[-40, 0], [-20, 20]] },
      },
      inertia1: {
        name: "inertia1",
        classRef: "Modelica.Mechanics.Rotational.Components.Inertia",
        placement: { extent: [[0, 0], [20, 20]] },
      },
      springdamper1: {
        name: "springdamper1",
        classRef:
          "Modelica.Mechanics.Rotational.Components.SpringDamper",
        placement: { extent: [[30, 0], [50, 20]] },
      },
    },
    connectors: {},
    connections: [
      {
        lhs: { component: "gain1", port: "y" },
        rhs: { component: "inertia1", port: "flange_a" },
        waypoints: [
          [-20, 10],
          [0, 10],
        ],
      },
      {
        lhs: { component: "inertia1", port: "flange_b" },
        rhs: { component: "springdamper1", port: "flange_a" },
        waypoints: [
          [20, 10],
          [30, 10],
        ],
      },
    ],
  };
}
