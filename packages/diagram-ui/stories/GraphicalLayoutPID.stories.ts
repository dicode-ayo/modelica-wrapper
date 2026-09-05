/**
 * Full-pipeline story: renders the `PID_Controller` layout built in
 * `fixtures/pid-layout.ts` with `<om-graphical-layout>`, the same element
 * the VSCode extension mounts.
 *
 * Browser memory: ~1.3 MB JSON fixture plus the textures rasterized
 * lazily per unique class — typical icon count on PID_Controller is
 * < 15, well within the icon-cache's per-SVG dedup.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";

import { pidLayout } from "./fixtures/pid-layout.js";
import { appendConnection } from "./fixtures/story-layout-state.js";

// Mutable state — see GraphicalLayout.stories.ts for the rationale.
// Stories share their own state; the PID fixture is large enough that
// resetting on every render would be jarring (auto-fit re-runs).
let currentLayout: DiagramLayout = pidLayout;

interface StoryArgs {
  readonly: boolean;
  lineThicknessScale: number;
  perfHud: boolean;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/GraphicalLayoutPID",
  render: ({
    readonly,
    lineThicknessScale,
    perfHud,
  }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>
        &lt;om-graphical-layout&gt; — Modelica.Blocks.Examples.PID_Controller
      </h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Full diagram of the PID controller example: LimPID + driveAngle
        (KinematicPTP) + inertia1/2 + spring + torque + sensors + load torque,
        wired together as in the Modelica standard library. Drag components,
        rubber-band select, Delete to remove, R/F to rotate/flip. Touchpad
        two-finger scroll pans, pinch zooms. Double-click on empty canvas to
        open the library browser (this story uses a fake catalog).
      </p>
      <div class="om-story-canvas-host" style="height: 600px;">
        <om-graphical-layout
          .layout=${currentLayout}
          ?readonly=${readonly}
          ?perf-hud=${perfHud}
          .lineThicknessScale=${lineThicknessScale}
          @om-graphical-layout-change=${(e: CustomEvent<DiagramLayout>) => {
            currentLayout = e.detail;
          }}
          @om-connection-create=${(e: CustomEvent) => {
            const detail = e.detail as {
              fromKey: string;
              toKey: string;
              waypoints: ReadonlyArray<readonly [number, number]>;
            };
            currentLayout = appendConnection(currentLayout, detail);
            const el = e.currentTarget as HTMLElement & {
              layout: DiagramLayout;
            };
            el.layout = currentLayout;
          }}
        ></om-graphical-layout>
      </div>
    </div>
  `,
  argTypes: {
    readonly: { control: { type: "boolean" } },
    lineThicknessScale: {
      control: { type: "range", min: 0.5, max: 10, step: 0.25 },
      name: "line-thickness-scale",
    },
    perfHud: {
      control: { type: "boolean" },
      name: "perf-hud",
    },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Editable: Story = {
  args: {
    readonly: false,
    lineThicknessScale: 1,
    perfHud: true,
  },
  parameters: { chromatic: { disableSnapshot: true } },
};

export const Readonly: Story = {
  args: {
    readonly: true,
    lineThicknessScale: 1,
    perfHud: true,
  },
  parameters: { chromatic: { disableSnapshot: true } },
};

export const ThickLines: Story = {
  args: { readonly: true, lineThicknessScale: 8 },
};
