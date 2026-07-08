/**
 * End-to-end story for drag-to-instantiate: `<om-library-tree>` beside
 * `<om-graphical-layout>` in one view. Drag a class row from the tree onto
 * the canvas and it drops in as a component at the cursor.
 *
 * The tree writes `{ className }` onto the drag `DataTransfer`; the canvas is
 * a drop target that converts the drop point to diagram space and emits
 * `om-add-component-request`. This story handles that event the way the
 * extension host does — appending the component to the layout and pushing it
 * back — so the drop is visible immediately.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/library-tree/library-tree.component.js";
import "../src/graphical-layout/graphical-layout.component.js";
import type { AddComponentRequestDetail } from "../src/graphical-layout/layout-events.js";
import { fakeLibrarySource } from "./fixtures/fake-library.js";
import { sampleLayout } from "./fixtures/sample-layout.js";
import { appendComponent } from "./fixtures/story-layout-state.js";

interface StoryArgs {
  readonly: boolean;
}

let currentLayout: DiagramLayout = sampleLayout();

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/DragToInstantiate",
  render: ({ readonly }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>Drag to instantiate</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Drag a class row from the tree onto the canvas — it instantiates as a
        component at the drop point. Toggle <code>readonly</code> to confirm the
        canvas refuses drops.
      </p>
      <div style="display:flex;gap:12px;height:540px;">
        <om-library-tree
          .dataSource=${fakeLibrarySource}
          style="flex:0 0 300px;min-height:0;border:1px solid var(--vscode-widget-border,#d0d0d0);border-radius:4px;padding:8px"
        ></om-library-tree>
        <div class="om-story-canvas-host" style="flex:1;min-width:0;">
          <om-graphical-layout
            .layout=${currentLayout}
            ?readonly=${readonly}
            @om-graphical-layout-change=${(e: CustomEvent<DiagramLayout>) => {
              currentLayout = e.detail;
            }}
            @om-add-component-request=${(
              e: CustomEvent<AddComponentRequestDetail>,
            ) => {
              currentLayout = appendComponent(
                currentLayout,
                e.detail.className,
                e.detail.position,
              );
              const el = e.currentTarget as HTMLElement & {
                layout: DiagramLayout;
              };
              el.layout = currentLayout;
            }}
          ></om-graphical-layout>
        </div>
      </div>
    </div>
  `,
  argTypes: {
    readonly: { control: { type: "boolean" } },
  },
  args: { readonly: false },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const Readonly: Story = {
  args: { readonly: true },
  parameters: { chromatic: { disableSnapshot: true } },
};
