/**
 * The diagram as the extension wires it (`webview-entry.ts`): the
 * `<om-graphical-layout>` canvas, the `<om-action-panel>` toolbar, and the
 * `<om-parameter-panel>` floating card, hooked together so the whole editor
 * surface is exercisable without an extension host. The host round-trips
 * that normally hit OMC are faked in-story:
 *
 *   - **Add components** — drag a class row from the docked `<om-library-tree>`
 *     (a fake Modelica tree) onto the canvas and it's instantiated at the drop
 *     point (`om-add-component-request` → `appendComponent`).
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
import "../src/library-tree/library-tree.component.js";
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

/**
 * Per-story root. Scoping queries here (instead of `document`) keeps the
 * Docs view — which renders every story onto one page — from matching the
 * first story's elements for all of them.
 */
const storyRoot = (node: EventTarget | null): ParentNode | null =>
  node instanceof Element ? node.closest(".om-story-canvas-host") : null;

const diagram = (root: ParentNode | null): OmGraphicalLayout | null =>
  root?.querySelector("om-graphical-layout") ?? null;
const actionPanel = (root: ParentNode | null): OmActionPanel | null =>
  root?.querySelector("om-action-panel") ?? null;
const paramPanel = (root: ParentNode | null): OmParameterPanel | null =>
  root?.querySelector("om-parameter-panel") ?? null;

/** Which flow opened the form, so the story logs the committed kind. */
let paramKind: "simulate" | "component" | null = null;

function openParams(
  root: ParentNode | null,
  opts: {
    kind: "simulate" | "component";
    model: ReturnType<typeof simulationOptionsModel>;
    title: string;
    submitLabel: string;
    showReset: boolean;
    crefPrefix?: string;
  },
): void {
  const panel = paramPanel(root);
  if (!panel) return;
  paramKind = opts.kind;
  panel.model = opts.model;
  panel.title = opts.title;
  panel.submitLabel = opts.submitLabel;
  panel.showReset = opts.showReset;
  panel.crefPrefix = opts.crefPrefix;
  panel.open = true;
}

function closeParams(root: ParentNode | null): void {
  const panel = paramPanel(root);
  if (panel) panel.open = false;
  paramKind = null;
}

function setLayout(root: ParentNode | null, next: DiagramLayout): void {
  currentLayout = next;
  const el = diagram(root);
  if (el) el.layout = currentLayout;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/DiagramWorkbench",
  parameters: { chromatic: { disableSnapshot: true } },
  render: ({ readonly }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>Diagram workbench</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        The full editor as the extension wires it. Drag a class row from the
        library tree onto the canvas to instantiate it; double-click a component
        to edit its parameters; the toolbar's simulate button opens simulation
        setup. Draw shapes from the toolbar, click/drag to select/move, R/F to
        rotate/flip.
      </p>
      <div class="om-story-workbench">
        <om-library-tree
          class="om-story-library-panel"
          .dataSource=${fakeLibrarySource}
        ></om-library-tree>
        <div class="om-story-canvas-host">
          <om-graphical-layout
            .layout=${currentLayout}
            ?readonly=${readonly}
            ?perf-hud=${true}
            @om-graphical-layout-change=${(e: CustomEvent<DiagramLayout>) => {
              currentLayout = e.detail;
            }}
            @om-selection-change=${(
              e: CustomEvent<LayoutEvents["om-selection-change"]>,
            ) => {
              const p = actionPanel(storyRoot(e.currentTarget));
              if (p) p.noSelection = e.detail.keys.length === 0;
            }}
            @om-tool-change=${(
              e: CustomEvent<LayoutEvents["om-tool-change"]>,
            ) => {
              const p = actionPanel(storyRoot(e.currentTarget));
              if (p) p.tool = e.detail.tool;
            }}
            @om-connection-create=${(
              e: CustomEvent<LayoutEvents["om-connection-create"]>,
            ) => {
              setLayout(
                storyRoot(e.currentTarget),
                appendConnection(currentLayout, e.detail),
              );
            }}
            @om-add-component-request=${(
              e: CustomEvent<LayoutEvents["om-add-component-request"]>,
            ) => {
              setLayout(
                storyRoot(e.currentTarget),
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
              openParams(storyRoot(e.currentTarget), {
                kind: "component",
                model: componentParamsModel(parsed.nodeId),
                title: parsed.nodeId,
                submitLabel: "Apply",
                showReset: true,
                crefPrefix: parsed.nodeId,
              });
            }}
          ></om-graphical-layout>
          <div class="om-story-overlay-stack">
            <om-action-panel
              ?no-selection=${true}
              @om-action-undo=${() => console.log("undo")}
              @om-action-check=${() => console.log("check")}
              @om-action-simulate=${() => console.log("simulate")}
              @om-action-parameters=${(e: Event) =>
                openParams(storyRoot(e.currentTarget), {
                  kind: "simulate",
                  model: simulationOptionsModel(currentLayout.className),
                  title: "Simulation setup",
                  submitLabel: "Simulate",
                  showReset: false,
                })}
              @om-action-rotate=${(e: CustomEvent<ActionRotateDetail>) =>
                diagram(storyRoot(e.currentTarget))?.rotateSelection(
                  e.detail.direction === "cw",
                )}
              @om-action-flip=${(e: CustomEvent<ActionFlipDetail>) =>
                diagram(storyRoot(e.currentTarget))?.flipSelection(
                  e.detail.axis === "horizontal",
                )}
              @om-action-tool=${(e: CustomEvent<ActionToolDetail>) =>
                diagram(storyRoot(e.currentTarget))?.setActiveTool(
                  e.detail.tool,
                )}
            ></om-action-panel>
            <om-parameter-panel
              @om-panel-submit=${(
                e: CustomEvent<ParameterFormSubmitDetail>,
              ) => {
                console.log(`apply (${paramKind})`, e.detail.values);
                closeParams(storyRoot(e.currentTarget));
              }}
              @om-panel-cancel=${(e: Event) =>
                closeParams(storyRoot(e.currentTarget))}
              @om-panel-reset=${() => console.log("reset to defaults")}
            ></om-parameter-panel>
          </div>
        </div>
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
