/**
 * `<om-result-plot-card>` — one plot card: a title, the list of its traces (each
 * removable), an ECharts line chart overlaying their trajectories, and an
 * `<om-add-trace-row>` to add more.
 *
 * The trace *rows* come from the card's persisted `traces` (so they can be
 * removed even before data loads); the chart *data* comes from the `traces`
 * payload the host pushes down. ECharts is created once and re-`setOption`ed when
 * the data or theme changes; a `ResizeObserver` keeps it sized.
 */

import {
  LitElement,
  css,
  html,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, property } from "lit/decorators.js";
import * as echarts from "echarts";

import { omTokens } from "@dicode/ui-common";

import { buildLineChartOption } from "./chart-option.js";
import { buildEchartTheme } from "./echart-theme.js";
import { fireEvent } from "./events.js";
import type { PlotCard, ResultRef, TracePayload } from "./types.js";
import "./add-trace-row.component.js";
import "./icon-button.component.js";

@customElement("om-result-plot-card")
export class OmResultPlotCard extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: block;
        border: 1px solid var(--vscode-panel-border);
        border-radius: var(--om-radius-md);
        padding: var(--om-space-md) var(--om-space-lg);
        margin-bottom: var(--om-space-md);
        background: var(--vscode-editorWidget-background, transparent);
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--om-space-sm);
      }
      header h4 {
        margin: 0;
        font-size: var(--om-description-size);
        font-weight: var(--om-title-weight);
      }
      .trace {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--om-space-sm);
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: var(--om-qualifier-size);
        color: var(--vscode-descriptionForeground);
        padding: 1px var(--om-space-xs);
        border-radius: var(--om-radius-sm);
      }
      .trace:hover {
        background: var(
          --vscode-list-hoverBackground,
          rgba(128, 128, 128, 0.1)
        );
      }
      .chart {
        min-height: var(--om-chart-min-height);
        margin-top: var(--om-space-sm);
      }
    `,
  ];

  /** Position, used only for the default "Plot N" label; data + events route by
   * `card.id`, never by this. */
  @property({ type: Number }) cardIndex = 0;
  @property({ attribute: false }) card: PlotCard = { kind: "plot", id: "" };
  @property({ attribute: false }) results: ResultRef[] = [];
  @property({ attribute: false }) traces: TracePayload[] = [];
  @property({ attribute: false }) variablesByResult: Record<string, string[]> =
    {};

  private chart: echarts.ECharts | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private themeObserver: MutationObserver | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.themeObserver = new MutationObserver(() => this.applyOption());
    this.themeObserver.observe(document.body, { attributeFilter: ["class"] });
  }

  override firstUpdated(): void {
    const el = this.renderRoot.querySelector<HTMLElement>(".chart");
    if (!el) return;
    this.chart = echarts.init(el);
    this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
    this.resizeObserver.observe(el);
  }

  override updated(changed: PropertyValues): void {
    if (changed.has("traces")) this.applyOption();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.themeObserver?.disconnect();
    this.themeObserver = undefined;
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
    this.chart = undefined;
  }

  private applyOption(): void {
    this.chart?.setOption(
      buildLineChartOption(this.traces, buildEchartTheme()),
      true,
    );
  }

  private resultLabel(id: string): string {
    return this.results.find((r) => r.id === id)?.label ?? id;
  }

  override render(): TemplateResult {
    const title = this.card.title ?? `Plot ${this.cardIndex + 1}`;
    const traceRows = this.card.traces ?? [];
    return html`
      <header>
        <h4>${title}</h4>
        <om-icon-button
          label="Delete plot"
          @click=${() =>
            fireEvent(this, "om-delete-plot", { cardId: this.card.id })}
        >
          ✕
        </om-icon-button>
      </header>
      ${traceRows.map(
        (tr, i) => html`
          <div class="trace">
            <span>${this.resultLabel(tr.result)} / ${tr.variable}</span>
            <om-icon-button
              label="Remove trace"
              @click=${() =>
                fireEvent(this, "om-remove-trace", {
                  cardId: this.card.id,
                  traceIndex: i,
                })}
            >
              ✕
            </om-icon-button>
          </div>
        `,
      )}
      <om-add-trace-row
        .cardId=${this.card.id}
        .results=${this.results}
        .variablesByResult=${this.variablesByResult}
      ></om-add-trace-row>
      <!-- Always present so ECharts inits once; shows empty axes until traces
           arrive, then re-setOption fills it without a re-init. -->
      <div class="chart"></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-result-plot-card": OmResultPlotCard;
  }
}
