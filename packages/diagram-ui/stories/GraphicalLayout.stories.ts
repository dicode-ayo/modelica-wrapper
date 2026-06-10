/**
 * End-to-end story for the `<om-graphical-layout>` host element. Loads
 * a synthetic `DiagramLayout` with three components + two routed
 * connections and wires up all the interaction surfaces.
 *
 * Try it:
 *  - wheel / middle-drag / shift-drag → pan / zoom
 *  - click a component               → select (HighlightLayer outline)
 *  - ctrl/cmd-click another component → add to / toggle selection
 *  - click empty space + drag        → rubber-band multi-select (band drawn)
 *  - drag a selected component       → move (draftLayout)
 *  - ctrl/cmd+C then ctrl/cmd+V      → copy / paste selection (offset)
 *  - hover a connector + drag        → in-progress connection edge
 *  - R / Shift+R                     → rotate selection
 *  - F / Shift+F                     → flip horizontal / vertical
 *  - Delete                          → remove selected entities
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import { sampleLayout } from "./fixtures/sample-layout.js";
import {
  appendComponent,
  appendConnection,
} from "./fixtures/story-layout-state.js";

interface StoryArgs {
  readonly: boolean;
}

// Mutable state owned by this story file. In production the layout
// round-trips through OMC; here we just append connection-create
// events directly so dropped connections immediately show up on
// screen with their orthogonal route.
let currentLayout: DiagramLayout = sampleLayout();

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/GraphicalLayout",
  render: ({ readonly }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>&lt;om-graphical-layout&gt;</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Synthetic DiagramLayout (3 mechanical-rotational blocks + 2
        connections). Click to select, drag to move, ctrl/cmd+click or
        rubber-band drag for multi-select, ctrl/cmd+C / +V to copy/paste, R/F
        for rotate/flip, Delete to remove. Hover a component, then drag from its
        port indicator to another port to create a new connection (orthogonal
        route).
      </p>
      <div class="om-story-canvas-host" style="height: 540px;">
        <om-graphical-layout
          .layout=${currentLayout}
          ?readonly=${readonly}
          @om-graphical-layout-change=${(e: CustomEvent<DiagramLayout>) => {
            currentLayout = e.detail;
          }}
          @om-selection-change=${(e: CustomEvent) => {
            const status = (
              e.currentTarget as HTMLElement
            ).parentElement?.parentElement?.querySelector(".om-status");
            if (status) {
              const keys = (e.detail as { keys: string[] }).keys;
              status.textContent = `selection: ${keys.length ? keys.join(", ") : "(none)"}`;
            }
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
          @om-add-component-request=${(e: CustomEvent) => {
            const detail = e.detail as {
              className: string;
              position: { x: number; y: number };
            };
            currentLayout = appendComponent(currentLayout, detail);
            const el = e.currentTarget as HTMLElement & {
              layout: DiagramLayout;
            };
            el.layout = currentLayout;
          }}
        ></om-graphical-layout>
      </div>
      <pre class="om-status" style="font-size:11px;color:#444;margin:8px 0;">
selection: (none)</pre
      >
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
