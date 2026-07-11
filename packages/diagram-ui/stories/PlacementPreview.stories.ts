/**
 * Demonstrates the drag-to-place preview (#259). Click a class button to arm a
 * placement, then move the cursor over the canvas: the class renders as the
 * component it will become — real icon and ports, at the size it will land —
 * tracking the cursor. Click on the canvas to commit, or press Escape / move
 * off-canvas to cancel.
 *
 * In the extension the host arms placement and supplies the class definition
 * over the sidebar bridge; here the buttons stand in for that, pulling the
 * definition straight from the sample layout.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import type { ClassDef, DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";
import type { AddComponentRequestDetail } from "../src/graphical-layout/layout-events.js";
import { sampleLayout } from "./fixtures/sample-layout.js";
import { appendComponent } from "./fixtures/story-layout-state.js";

let currentLayout: DiagramLayout = sampleLayout();

/** The placeable classes the sample layout defines, for the arm buttons. */
const PLACEABLE = [
  "Modelica.Blocks.Math.Gain",
  "Modelica.Mechanics.Rotational.Components.Inertia",
  "Modelica.Mechanics.Rotational.Components.SpringDamper",
];

function diagramEl(root: ParentNode | null): OmGraphicalLayout | null {
  return root?.querySelector("om-graphical-layout") ?? null;
}

function arm(e: Event, className: string): void {
  const root = (e.currentTarget as HTMLElement).closest(".om-story");
  const el = diagramEl(root);
  if (!el) return;
  const def = currentLayout.classes[className] as ClassDef | undefined;
  el.beginPlacement(className);
  if (def) el.setPlacementPreview(def);
}

function render(): TemplateResult {
  return html`
    <div class="om-story">
      <h3>Drag-to-place preview</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Click a class, then move the cursor over the canvas — it previews as the
        real component and commits on click. Escape or off-canvas cancels.
      </p>
      <div style="display:flex;gap:8px;margin:8px 0;">
        ${PLACEABLE.map(
          (className) =>
            html`<button
              type="button"
              @click=${(e: Event) => arm(e, className)}
            >
              Place ${className.split(".").pop()}
            </button>`,
        )}
      </div>
      <div class="om-story-canvas-host" style="height: 520px;">
        <om-graphical-layout
          .layout=${currentLayout}
          @om-add-component-request=${(
            e: CustomEvent<AddComponentRequestDetail>,
          ) => {
            currentLayout = appendComponent(
              currentLayout,
              e.detail.className,
              e.detail.position,
            );
            const el = e.currentTarget as OmGraphicalLayout;
            el.layout = currentLayout;
          }}
        ></om-graphical-layout>
      </div>
    </div>
  `;
}

const meta: Meta = {
  title: "diagram-ui/PlacementPreview",
  parameters: { chromatic: { disableSnapshot: true } },
  render,
};

export default meta;

type Story = StoryObj;

export const Default: Story = {};
