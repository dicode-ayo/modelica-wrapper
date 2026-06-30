/**
 * The diagram as the extension wires it (`webview-entry.ts`): the
 * `<om-graphical-layout>` canvas, the `<om-action-panel>` toolbar, and the
 * `<om-parameter-panel>` side drawer, hooked together so the whole editor
 * surface is exercisable without an extension host. The host round-trips
 * that normally hit OMC are faked in-story:
 *
 *   - **Add components** — double-click empty canvas to open the library
 *     browser (a fake Modelica tree), pick a class, and it's instantiated
 *     at the drop point (`om-add-component-request` → `appendComponent`).
 *   - **Edit parameters** — double-click a component to open its parameter
 *     form; the toolbar's simulate button opens the simulation-setup form.
 *   - **Draw / select / move** — toolbar shapes draw into the host layer;
 *     click selects, drag moves, R/F rotate/flip, Delete removes.
 *   - **Connect** — drag connector-to-connector lays a routed connection.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import "../src/action-panel/action-panel.component.js";
import "../src/parameter-form/parameter-panel.component.js";
import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";
import type { OmActionPanel } from "../src/action-panel/action-panel.component.js";
import type { OmParameterPanel } from "../src/parameter-form/parameter-panel.component.js";
import type {
  ActionFlipDetail,
  ActionRotateDetail,
  ActionToolDetail,
} from "../src/action-panel/action-panel.component.js";
import type { LayoutEvents } from "../src/graphical-layout/layout-events.js";
import type { ParameterFormSubmitDetail } from "../src/parameter-form/parameter-form.component.js";
import { isComponentKey, parseKey } from "../src/interaction/node-keys.js";

import { sampleLayout } from "./fixtures/sample-layout.js";
import {
  appendComponent,
  appendConnection,
} from "./fixtures/story-layout-state.js";
import { fakeLibrarySource } from "./fixtures/fake-library.js";
import {
  componentParamsModel,
  simulationOptionsModel,
} from "./fixtures/fake-parameters.js";

interface StoryArgs {
  readonly: boolean;
}

let currentLayout: DiagramLayout = sampleLayout();

const diagram = (): OmGraphicalLayout | null =>
  document.querySelector("om-graphical-layout");
const actionPanel = (): OmActionPanel | null =>
  document.querySelector("om-action-panel");
const paramPanel = (): OmParameterPanel | null =>
  document.querySelector("om-parameter-panel");

/** Which flow opened the form, so the story logs the committed kind. */
let paramKind: "simulate" | "component" | null = null;

function openParams(opts: {
  kind: "simulate" | "component";
  model: ReturnType<typeof simulationOptionsModel>;
  title: string;
  submitLabel: string;
  showReset: boolean;
  crefPrefix?: string;
}): void {
  const panel = paramPanel();
  if (!panel) return;
  paramKind = opts.kind;
  panel.model = opts.model;
  panel.title = opts.title;
  panel.submitLabel = opts.submitLabel;
  panel.showReset = opts.showReset;
  panel.crefPrefix = opts.crefPrefix;
  panel.open = true;
}

function closeParams(): void {
  const panel = paramPanel();
  if (panel) panel.open = false;
  paramKind = null;
}

function setLayout(next: DiagramLayout): void {
  currentLayout = next;
  const el = diagram();
  if (el) el.layout = currentLayout;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/DiagramWorkbench",
  render: ({ readonly }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>Diagram workbench</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        The full editor as the extension wires it. Double-click empty canvas to
        add a component from the library; double-click a component to edit its
        parameters; the toolbar's simulate button opens simulation setup. Draw
        shapes from the toolbar, click/drag to select/move, R/F to rotate/flip.
      </p>
      <div
        class="om-story-canvas-host"
        style="position: relative; height: 560px;"
      >
        <om-graphical-layout
          .layout=${currentLayout}
          ?readonly=${readonly}
          ?perf-hud=${true}
          .libraryDataSource=${fakeLibrarySource}
          @om-graphical-layout-change=${(e: CustomEvent<DiagramLayout>) => {
            currentLayout = e.detail;
          }}
          @om-selection-change=${(
            e: CustomEvent<LayoutEvents["om-selection-change"]>,
          ) => {
            const p = actionPanel();
            if (p) p.noSelection = e.detail.keys.length === 0;
          }}
          @om-tool-change=${(
            e: CustomEvent<LayoutEvents["om-tool-change"]>,
          ) => {
            const p = actionPanel();
            if (p) p.tool = e.detail.tool;
          }}
          @om-connection-create=${(
            e: CustomEvent<LayoutEvents["om-connection-create"]>,
          ) => {
            setLayout(appendConnection(currentLayout, e.detail));
          }}
          @om-add-component-request=${(
            e: CustomEvent<LayoutEvents["om-add-component-request"]>,
          ) => {
            setLayout(
              appendComponent(
                currentLayout,
                e.detail.className,
                e.detail.position,
              ),
            );
          }}
          @om-double-click=${(
            e: CustomEvent<LayoutEvents["om-double-click"]>,
          ) => {
            const parsed = parseKey(e.detail.key);
            if (!parsed || !isComponentKey(parsed) || parsed.nodeId === "") {
              return;
            }
            openParams({
              kind: "component",
              model: componentParamsModel(parsed.nodeId),
              title: parsed.nodeId,
              submitLabel: "Apply",
              showReset: true,
              crefPrefix: parsed.nodeId,
            });
          }}
        ></om-graphical-layout>
        <om-action-panel
          anchor="top-right"
          ?no-selection=${true}
          @om-action-undo=${() => console.log("undo")}
          @om-action-check=${() => console.log("check")}
          @om-action-simulate=${() => console.log("simulate")}
          @om-action-parameters=${() =>
            openParams({
              kind: "simulate",
              model: simulationOptionsModel(currentLayout.className),
              title: "Simulation setup",
              submitLabel: "Simulate",
              showReset: false,
            })}
          @om-action-rotate=${(e: CustomEvent<ActionRotateDetail>) =>
            diagram()?.rotateSelection(e.detail.direction === "cw")}
          @om-action-flip=${(e: CustomEvent<ActionFlipDetail>) =>
            diagram()?.flipSelection(e.detail.axis === "horizontal")}
          @om-action-tool=${(e: CustomEvent<ActionToolDetail>) =>
            diagram()?.setActiveTool(e.detail.tool)}
        ></om-action-panel>
        <om-parameter-panel
          @om-panel-submit=${(e: CustomEvent<ParameterFormSubmitDetail>) => {
            console.log(`apply (${paramKind})`, e.detail.values);
            closeParams();
          }}
          @om-panel-cancel=${() => closeParams()}
          @om-panel-reset=${() => console.log("reset to defaults")}
        ></om-parameter-panel>
      </div>
    </div>
  `,
  argTypes: {
    readonly: { control: { type: "boolean" } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {
  args: { readonly: false },
};

export const Readonly: Story = {
  args: { readonly: true },
};
