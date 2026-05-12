/**
 * Full-pipeline story: feeds the captured `getModelInstance` output for
 * `Modelica.Blocks.Examples.PID_Controller` through the same code path
 * the VSCode extension uses, then renders the result with
 * `<om-graphical-layout>`.
 *
 *   pidController.modelInstance.json  (real OMC capture, 1.3 MB)
 *     → ModelInstanceSchema.parse              (validate)
 *     → diagram.produceDiagramLayout(mi, 'diagram')   (typed layout)
 *     → <om-graphical-layout .layout=${layout}>
 *
 * This is the heaviest visual test of the editor — every layer (icon
 * provider + texture cache, component placement, nested connectors via
 * class.connectors PortDef, multi-segment connection waypoints,
 * GreasedLine routing) gets exercised against real Modelica data.
 *
 * Browser memory: ~1.3 MB JSON fixture plus the textures rasterised
 * lazily per unique class — typical icon count on PID_Controller is
 * < 15, well within the icon-cache's per-SVG dedup.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
// Deep subpath import: pulls only the pure producer (and its shape /
// placement helpers). Importing from the package root would bring in
// `OmcClient` + `spawnOmc` which depend on `zeromq` / `node:fs` and
// can't bundle for the browser.
import { produceDiagramLayout } from "@modelica-wrapper/omc-client/api/diagram/index.js";
import type { ModelInstance } from "@modelica-wrapper/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";

import pidFixture from "./fixtures/pidController.modelInstance.json";

// The fixture was captured against a real OMC and is known-valid
// (the producer's own test suite validates it on every push). We
// skip ModelInstanceSchema.parse here to keep the story bundle
// browser-only — the schema module itself is browser-safe, but
// re-exporting it from the omc-client barrel forces the OmcClient
// class import too.
const pidLayout = produceDiagramLayout(
  pidFixture as unknown as ModelInstance,
  "diagram",
);

interface StoryArgs {
  readonly: boolean;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/GraphicalLayoutPID",
  render: ({ readonly }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>&lt;om-graphical-layout&gt; — Modelica.Blocks.Examples.PID_Controller</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Full diagram of the PID controller example: LimPID + driveAngle
        (KinematicPTP) + inertia1/2 + spring + torque + sensors + load
        torque, wired together as in the Modelica standard library.
        Drag components, rubber-band select, Delete to remove, R/F to
        rotate/flip. Layout changes log to the browser console.
      </p>
      <div class="om-story-canvas-host" style="height: 600px;">
        <om-graphical-layout
          .layout=${pidLayout}
          ?readonly=${readonly}
          @om-graphical-layout-change=${(e: CustomEvent) => {
            // eslint-disable-next-line no-console
            console.log("layout change", e.detail);
          }}
          @om-connection-create=${(e: CustomEvent) => {
            // eslint-disable-next-line no-console
            console.log("connection create", e.detail);
          }}
        ></om-graphical-layout>
      </div>
    </div>
  `,
  argTypes: {
    readonly: { control: { type: "boolean" } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Editable: Story = {
  args: { readonly: false },
};

export const Readonly: Story = {
  args: { readonly: true },
};
