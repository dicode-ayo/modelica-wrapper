/**
 * Zoom onto `PI` (a LimPID) to open its class diagram in place. Without OMC,
 * LimPID comes from PID_Controller's captured subtree, so it has blocks but
 * no wires.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import { produceDiagramLayout } from "@dicode/omc-client/api/diagram";
import type { ModelInstance } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { NestedDiagramSource } from "../src/nesting/nested-diagram-source.js";

import { pidInstance, pidLayout } from "./fixtures/pid-layout.js";

const subtreeSource: NestedDiagramSource = (className) => {
  const type = pidInstance.elements
    ?.map((e) => (e.$kind === "component" ? e.type : undefined))
    .find(
      (t): t is ModelInstance => typeof t === "object" && t.name === className,
    );
  return type
    ? Promise.resolve(produceDiagramLayout(type, "diagram"))
    : Promise.reject(new Error(`${className} is not in the fixture`));
};

const meta: Meta = {
  title: "diagram-ui/SemanticNesting",
  render: (): TemplateResult => html`
    <div class="om-story">
      <h3>Semantic in-place nesting — PID_Controller</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Zoom onto PI: its LimPID diagram cross-fades in once the box is about
        140 px on screen and is fully open at 200 px. Leaves never open. Nothing
        inside an open box is pickable.
      </p>
      <div class="om-story-canvas-host" style="height: 600px;">
        <om-graphical-layout
          .layout=${pidLayout}
          .nestedDiagramSource=${subtreeSource}
          readonly
          perf-hud
        ></om-graphical-layout>
      </div>
    </div>
  `,
};

export default meta;

export const PIDController: StoryObj = {
  parameters: { chromatic: { disableSnapshot: true } },
};
