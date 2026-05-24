/**
 * Stories for the postprocessing view, driven entirely by mock data (no host,
 * no OMC). The components' bubbling, composed events are captured by the actions
 * addon (`parameters.actions.handles`) and shown in the Actions panel — the real
 * webview routes the same events to extension messages.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/index.js";
import "./mock-host.js";
import type { PlotCard } from "../src/types.js";
import {
  sampleDoc,
  sampleTraceData,
  sampleVariablesByResult,
} from "./fixtures/sample.js";

const meta: Meta = {
  title: "result-ui/Postprocessing",
  parameters: {
    actions: {
      handles: [
        "om-add-plot",
        "om-delete-plot",
        "om-add-trace",
        "om-remove-trace",
        "om-request-variables",
        "om-add-result",
        "om-remove-result",
        "om-rename-result",
      ],
    },
  },
};
export default meta;

type Story = StoryObj;

/** The whole view: results rail + plot cards, one populated, one empty. */
export const FullView: Story = {
  render: (): TemplateResult => html`
    <div class="om-story-host">
      <om-result-view-app
        .doc=${sampleDoc}
        .traceData=${sampleTraceData}
        .variablesByResult=${sampleVariablesByResult}
      ></om-result-view-app>
    </div>
  `,
};

/** Empty state — no results, no cards. */
export const Empty: Story = {
  render: (): TemplateResult => html`
    <div class="om-story-host">
      <om-result-view-app
        .doc=${{ version: 1, results: [], cards: [] }}
      ></om-result-view-app>
    </div>
  `,
};

/**
 * Interactive — a stateful mock host closes the loop: add/delete plots, add/remove
 * traces (charts re-synthesise), pick any result (variables load lazily after a
 * tick), and add/remove results. The Actions panel still shows every event. This
 * is the closest thing to the live editor without OMC/VSCode.
 */
export const Playground: Story = {
  render: (): TemplateResult => html`
    <div class="om-story-host">
      <om-result-view-mock-host></om-result-view-mock-host>
    </div>
  `,
};

/** A single plot card with two overlaid traces. */
export const SinglePlotCard: Story = {
  render: (): TemplateResult => {
    const card: PlotCard = sampleDoc.cards[0] as PlotCard;
    return html`
      <div class="om-story-host">
        <om-result-plot-card
          .cardIndex=${0}
          .card=${card}
          .results=${sampleDoc.results}
          .traces=${sampleTraceData[card.id] ?? []}
          .variablesByResult=${sampleVariablesByResult}
        ></om-result-plot-card>
      </div>
    `;
  },
};
