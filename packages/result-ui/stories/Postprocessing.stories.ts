/**
 * Stories for the postprocessing view, driven entirely by mock data (no host,
 * no OMC). Event handlers log to console — the real webview routes them to
 * extension messages.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/index.js";
import type { PlotCard } from "../src/types.js";
import {
  sampleDoc,
  sampleTraceData,
  sampleVariablesByResult,
} from "./fixtures/sample.js";

const logHandlers = {
  "@om-add-plot": (e: Event) => console.log("add-plot", (e as CustomEvent).detail),
  "@om-delete-plot": (e: Event) => console.log("delete-plot", (e as CustomEvent).detail),
  "@om-add-trace": (e: Event) => console.log("add-trace", (e as CustomEvent).detail),
  "@om-remove-trace": (e: Event) => console.log("remove-trace", (e as CustomEvent).detail),
  "@om-request-variables": (e: Event) =>
    console.log("request-variables", (e as CustomEvent).detail),
  "@om-add-result": (e: Event) => console.log("add-result", (e as CustomEvent).detail),
  "@om-remove-result": (e: Event) => console.log("remove-result", (e as CustomEvent).detail),
};

const meta: Meta = {
  title: "result-ui/Postprocessing",
};
export default meta;

type Story = StoryObj;

/** The whole view: results rail + plot cards, one populated, one empty. */
export const FullView: Story = {
  render: (): TemplateResult => html`
    <div
      class="om-story-host"
      @om-add-plot=${logHandlers["@om-add-plot"]}
      @om-delete-plot=${logHandlers["@om-delete-plot"]}
      @om-add-trace=${logHandlers["@om-add-trace"]}
      @om-remove-trace=${logHandlers["@om-remove-trace"]}
      @om-request-variables=${logHandlers["@om-request-variables"]}
      @om-add-result=${logHandlers["@om-add-result"]}
      @om-remove-result=${logHandlers["@om-remove-result"]}
    >
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

/** A single plot card with two overlaid traces. */
export const SinglePlotCard: Story = {
  render: (): TemplateResult => {
    const card: PlotCard = sampleDoc.cards[0] as PlotCard;
    return html`
      <div
        style="width: 640px; padding: 16px;"
        @om-remove-trace=${logHandlers["@om-remove-trace"]}
        @om-add-trace=${logHandlers["@om-add-trace"]}
        @om-request-variables=${logHandlers["@om-request-variables"]}
        @om-delete-plot=${logHandlers["@om-delete-plot"]}
      >
        <om-result-plot-card
          .cardIndex=${0}
          .card=${card}
          .results=${sampleDoc.results}
          .traces=${sampleTraceData[0] ?? []}
          .variablesByResult=${sampleVariablesByResult}
        ></om-result-plot-card>
      </div>
    `;
  },
};
