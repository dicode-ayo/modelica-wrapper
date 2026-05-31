/**
 * Debug story: identical to GraphicalLayoutPID but exposes the
 * `debug` toggle on `<om-graphical-layout>`'s inner scene. Turn the
 * toggle on and Babylon's full Inspector opens on the right side —
 * use it to:
 *
 *   - Pick an `<om-component>` plane and inspect its material in
 *     "Materials → om-component:...-mat". The `emissiveTexture`,
 *     `diffuseTexture` and `hasAlpha` settings are visible, and the
 *     texture preview shows whether the SVG actually rasterised
 *     into something non-empty.
 *   - "Statistics" panel shows draw call count + frame time.
 *   - "Tools → Render Inspector" snapshots the framebuffer.
 *
 * The rasteriser logs every successful texture load + every failure
 * to the browser console when `debug=true`. Looks like:
 *
 *   [diagram-ui] SVG texture ready { size, hasAlpha, svgPreview }
 *
 * If you see the magenta placeholder colour instead of an icon, the
 * texture failed to load — check console for the "SVG → Texture load
 * failed" error message.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import { produceDiagramLayout } from "@dicode/omc-client/api/diagram/index.js";
import type { ModelInstance } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";

import pidFixture from "./fixtures/pidController.modelInstance.json";

const pidLayout = produceDiagramLayout(
  pidFixture as unknown as ModelInstance,
  "diagram",
);

interface StoryArgs {
  debug: boolean;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/Debug",
  render: ({ debug }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>Debug — PID_Controller with Babylon Inspector</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Toggle <code>debug</code> to open Babylon's Inspector on the right side
        of the canvas. Magenta = no texture bound (load failed or pending).
        Watch the browser console for <code>[diagram-ui]</code> log lines.
      </p>
      <div class="om-story-canvas-host" style="height: 600px;">
        <om-graphical-layout
          .layout=${pidLayout}
          ?debug=${debug}
        ></om-graphical-layout>
      </div>
    </div>
  `,
  argTypes: {
    debug: { control: { type: "boolean" } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const InspectorOpen: Story = {
  args: { debug: true },
};

export const InspectorClosed: Story = {
  args: { debug: false },
};
