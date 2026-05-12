/**
 * Visual story for `<om-connector>` (standalone + nested).
 *
 * "Standalone" places a connector directly under `<om-scene>` — used
 * for the host class's own ports.
 *
 * "NestedOnComponent" puts a `<om-connector>` inside an `<om-component>`,
 * exercising the parent-node context propagation so the connector's
 * placement resolves in the component's class icon-coord system.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type {
  CoordinateSystem,
  IconLayer,
  Placement,
} from "@modelica-wrapper/omc-client";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import "../src/icon-provider/icon-provider.component.js";
import "../src/component/component.component.js";
import "../src/connector/connector.component.js";

import gainFixture from "./fixtures/gain.icon.json";

interface IconFixture {
  className: string;
  iconLayers: IconLayer[];
  coordinateSystem?: CoordinateSystem | null;
}

// Trivial connector icon: filled rectangle as a placeholder for a real
// connector class. Once the producer feeds in real connector classes
// from PortDef the story can swap this out.
const PLACEHOLDER_CONNECTOR_LAYERS: IconLayer[] = [
  {
    from: "Demo.Connector",
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

interface StandaloneArgs {
  showPortIndicator: boolean;
  rotation: number;
  zoom: number;
}

const standaloneMeta: Meta<StandaloneArgs> = {
  title: "diagram-ui/Connector",
  render: ({ showPortIndicator, rotation, zoom }: StandaloneArgs): TemplateResult => {
    const placement: Placement = {
      extent: [[-8, -8], [8, 8]],
      rotation,
    };
    return html`
      <div class="om-story">
        <h3>&lt;om-connector&gt; — standalone</h3>
        <p style="font-size:11px;color:#666;margin:4px 0;">
          Connector on the host class. Toggle the port indicator to see
          the hover affordance (E1 will drive this from real pointer events).
        </p>
        <div class="om-story-canvas-host">
          <om-scene .zoom=${zoom}>
            <om-icon-provider>
              <om-grid-axis .extent=${500}></om-grid-axis>
              <om-connector
                nodeId="p"
                .placement=${placement}
                .layers=${PLACEHOLDER_CONNECTOR_LAYERS}
                @om-connector-ready=${(e: CustomEvent) => {
                  // Story-only: respect the toggle by re-querying after mount.
                  const el = e.target as HTMLElement & {
                    setPortIndicatorVisible: (b: boolean) => void;
                  };
                  el.setPortIndicatorVisible(showPortIndicator);
                }}
              ></om-connector>
            </om-icon-provider>
          </om-scene>
        </div>
      </div>
    `;
  },
  argTypes: {
    showPortIndicator: { control: { type: "boolean" } },
    rotation: { control: { type: "range", min: -180, max: 180, step: 5 } },
    zoom: { control: { type: "range", min: 20, max: 200, step: 5 } },
  },
};

export default standaloneMeta;

type StandaloneStory = StoryObj<StandaloneArgs>;

export const Standalone: StandaloneStory = {
  args: {
    showPortIndicator: true,
    rotation: 0,
    zoom: 60,
  },
};

interface NestedArgs {
  connectorPlacementX: number;
  zoom: number;
}

export const NestedOnComponent: StoryObj<NestedArgs> = {
  args: {
    // Default places the port at the right edge of the Gain block.
    // The component's icon coord system is [-100, 100]² so x=110
    // sits just past the boundary — like a real Modelica port.
    connectorPlacementX: 110,
    zoom: 100,
  },
  argTypes: {
    connectorPlacementX: {
      control: { type: "range", min: -120, max: 120, step: 5 },
    },
    zoom: { control: { type: "range", min: 30, max: 250, step: 5 } },
  },
  render: ({ connectorPlacementX, zoom }): TemplateResult => {
    const f = gainFixture as IconFixture;
    const componentPlacement: Placement = {
      extent: [[-30, -30], [30, 30]],
    };
    const connectorPlacement: Placement = {
      extent: [
        [connectorPlacementX - 10, -10],
        [connectorPlacementX + 10, 10],
      ],
    };
    return html`
      <div class="om-story">
        <h3>&lt;om-connector&gt; — nested on Gain block</h3>
        <p style="font-size:11px;color:#666;margin:4px 0;">
          The connector sits in the Gain block's icon coord system
          ([-100, 100]²). Slide the X placement to see it tracks the
          block's local frame.
        </p>
        <div class="om-story-canvas-host">
          <om-scene .zoom=${zoom}>
            <om-icon-provider>
              <om-grid-axis .extent=${500}></om-grid-axis>
              <om-component
                nodeId="g1"
                .placement=${componentPlacement}
                .layers=${f.iconLayers}
                .coordinateSystem=${f.coordinateSystem ?? undefined}
              >
                <om-connector
                  nodeId="p"
                  .placement=${connectorPlacement}
                  .layers=${PLACEHOLDER_CONNECTOR_LAYERS}
                ></om-connector>
              </om-component>
            </om-icon-provider>
          </om-scene>
        </div>
      </div>
    `;
  },
};
