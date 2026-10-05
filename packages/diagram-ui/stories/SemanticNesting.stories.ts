/**
 * Semantic in-place nesting on `PID_Controller`: zoom onto `PI` (a LimPID)
 * and its class diagram fades in inside its own box.
 *
 * The extension fetches each nested class as its own root. This story has
 * no OMC, so it produces LimPID from the subtree PID_Controller's capture
 * already carries, which places LimPID's components but resolves none of
 * its connections — the nested view here shows blocks without wires.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import { produceDiagramLayout } from "@dicode/omc-client/api/diagram";
import type { ModelInstance } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { NestedDiagramSource } from "../src/nesting/nested-diagram-source.js";

import { pidLayout } from "./fixtures/pid-layout.js";
import pidFixture from "./fixtures/pidController.modelInstance.json";

interface ComponentElement {
  $kind?: string;
  type?: unknown;
}

function isModelInstance(type: unknown): type is ModelInstance {
  return typeof type === "object" && type !== null && "name" in type;
}

const subtreeSource: NestedDiagramSource = (className) => {
  const elements = (pidFixture as { elements?: ComponentElement[] }).elements;
  const type = elements
    ?.map((e) => e.type)
    .find((t) => isModelInstance(t) && t.name === className);
  return isModelInstance(type)
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
