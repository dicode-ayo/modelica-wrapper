/**
 * Interactive story for connection waypoint insert / delete on the
 * `<om-graphical-layout>` host.
 *
 * Try it:
 *  - double-click a connection's line  → insert a waypoint at the click
 *  - double-click a junction dot        → delete that waypoint
 *
 * The host commits each edit by emitting `om-graphical-layout-change`
 * with the full layout; this story feeds it straight back into the
 * element so the new route is visible immediately. In the extension
 * the same event round-trips through OMC's `Line(points=...)` write
 * path (`apply-edits.ts` / `diff-layout.ts`).
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type { DiagramLayout, Point } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import { sampleLayout } from "./fixtures/sample-layout.js";

interface StoryArgs {
  readonly: boolean;
}

/** sampleLayout() with the first connection given a multi-segment Z so
 *  there are internal waypoints to delete out of the box. */
function waypointLayout(): DiagramLayout {
  const base = sampleLayout();
  const first = base.connections[0];
  if (!first) {
    return base;
  }
  const waypoints: Point[] = [
    [-20, 10],
    [-10, 10],
    [-10, 40],
    [0, 40],
    [0, 10],
  ];
  const reshaped = { ...first, waypoints };
  return {
    ...base,
    connections: [reshaped, ...base.connections.slice(1)],
  };
}

let currentLayout: DiagramLayout = waypointLayout();

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/ConnectionWaypoints",
  render: ({ readonly }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>Connection waypoint insert / delete</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Double-click a connection line to insert a waypoint at that point;
        double-click a junction dot to delete it. The first connection starts
        with a multi-segment route so there are dots to remove.
      </p>
      <div class="om-story-canvas-host" style="height: 540px;">
        <om-graphical-layout
          .layout=${currentLayout}
          ?readonly=${readonly}
          @om-graphical-layout-change=${(e: CustomEvent<DiagramLayout>) => {
            currentLayout = e.detail;
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
