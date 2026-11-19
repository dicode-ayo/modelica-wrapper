/**
 * Zoom onto `PI` (a LimPID) to open its class diagram in place. Without OMC,
 * LimPID comes from PID_Controller's captured subtree, so it has blocks but
 * no wires. `SlowSource` answers after a delay, standing in for a busy OMC.
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

interface NestingArgs {
  /** How long the nested source takes to answer, in ms. */
  delayMs: number;
}

function delayed(
  source: NestedDiagramSource,
  delayMs: number,
): NestedDiagramSource {
  if (delayMs <= 0) return source;
  return (className) =>
    new Promise((resolve) => setTimeout(resolve, delayMs)).then(() =>
      source(className),
    );
}

const meta: Meta<NestingArgs> = {
  title: "diagram-ui/SemanticNesting",
  render: ({ delayMs }): TemplateResult => html`
    <div class="om-story">
      <h3>Semantic in-place nesting — PID_Controller</h3>
      <p style="font-size:11px;color:#666;margin:4px 0;">
        Zoom onto PI: its LimPID diagram is fetched once the box is about 100 px
        on screen, cross-fades in from about 140 px and is fully open at 200 px.
        A diagram that arrives after the box has started to open fades in over a
        short beat instead of popping in. Leaves never open. Nothing inside an
        open box is pickable. The frame around an open box is a faint
        translucent outline, so it groups the content without competing with it.
      </p>
      <div class="om-story-canvas-host" style="height: 600px;">
        <om-graphical-layout
          .layout=${pidLayout}
          .nestedDiagramSource=${delayed(subtreeSource, delayMs)}
          readonly
          perf-hud
        ></om-graphical-layout>
      </div>
    </div>
  `,
  argTypes: {
    delayMs: { control: { type: "range", min: 0, max: 3000, step: 100 } },
  },
  args: { delayMs: 0 },
};

export default meta;

export const PIDController: StoryObj<NestingArgs> = {
  parameters: { chromatic: { disableSnapshot: true } },
};

/** Zoom in fast past PI's prefetch size to see a late diagram fade in. */
export const SlowSource: StoryObj<NestingArgs> = {
  args: { delayMs: 1500 },
  parameters: { chromatic: { disableSnapshot: true } },
};
