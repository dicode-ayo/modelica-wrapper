/**
 * `<om-graphical-layout>` with its docked library palette — the composition
 * the extension webview ships. One `libraryDataSource` feeds both the palette
 * tree (a drag source) and the double-click library browser; dragging a class
 * row from the palette onto the canvas instantiates it at the drop point.
 *
 * The palette and the canvas live in the same component, so the drag is
 * same-document HTML5 DnD — exactly what the webview does. This story handles
 * `om-add-component-request` the way the host does (append + push back) so the
 * drop is visible immediately. Toggle the header button to collapse the
 * palette to its show-rail.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { AddComponentRequestDetail } from "../src/graphical-layout/layout-events.js";
import { fakeLibrarySource } from "./fixtures/fake-library.js";
import { sampleLayout } from "./fixtures/sample-layout.js";
import { appendComponent } from "./fixtures/story-layout-state.js";

interface StoryArgs {
  readonly: boolean;
  showPalette: boolean;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/LibraryPalette",
  parameters: { chromatic: { disableSnapshot: true } },
  argTypes: {
    readonly: { control: { type: "boolean" } },
    showPalette: { control: { type: "boolean" } },
  },
  args: { readonly: false, showPalette: true },
};

export default meta;

type Story = StoryObj<StoryArgs>;

/**
 * One story instance. Each closes over its own mutable `layout` so drops in
 * one story don't bleed into another when the Docs page renders them together.
 */
function paletteStory(overrides: Partial<StoryArgs> = {}): Story {
  let layout: DiagramLayout = sampleLayout();
  return {
    args: overrides,
    render: ({ readonly, showPalette }: StoryArgs): TemplateResult => html`
      <div class="om-story">
        <h3>Library palette</h3>
        <p class="om-story-caption">
          Drag a class row from the docked palette onto the canvas to
          instantiate it. Use the header button to collapse the palette to its
          show-rail; double-click empty canvas still opens the library browser
          overlay.
        </p>
        <div class="om-story-canvas-host">
          <om-graphical-layout
            .layout=${layout}
            ?readonly=${readonly}
            ?show-palette=${showPalette}
            .libraryDataSource=${fakeLibrarySource}
            @om-graphical-layout-change=${(e: CustomEvent<DiagramLayout>) => {
              layout = e.detail;
            }}
            @om-add-component-request=${(
              e: CustomEvent<AddComponentRequestDetail>,
            ) => {
              layout = appendComponent(
                layout,
                e.detail.className,
                e.detail.position,
              );
              const el = e.currentTarget as HTMLElement & {
                layout: DiagramLayout;
              };
              el.layout = layout;
            }}
          ></om-graphical-layout>
        </div>
      </div>
    `,
  };
}

export const Default: Story = paletteStory();

export const Collapsed: Story = paletteStory({ showPalette: false });
