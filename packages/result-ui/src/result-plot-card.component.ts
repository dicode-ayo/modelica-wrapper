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

import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import * as echarts from "echarts";

import { omTokens } from "@modelica-wrapper/ui-common";

import { buildLineChartOption } from "./chart-option.js";
import { buildEchartTheme } from "./echart-theme.js";
import { fireEvent } from "./events.js";
import type { PlotCard, ResultRef, TracePayload } from "./types.js";
import "./add-trace-row.component.js";

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
        font-size: 0.95em;
        font-weight: 600;
      }
      .icon-btn {
        border: none;
        background: transparent;
        cursor: pointer;
        color: var(--vscode-descriptionForeground);
        border-radius: var(--om-radius-sm);
        padding: 0 var(--om-space-xs);
        line-height: 1.4;
      }
      .icon-btn:hover {
        color: var(--vscode-errorForeground);
        background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
      }
      .trace {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--om-space-sm);
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 0.82em;
        color: var(--vscode-descriptionForeground);
        padding: 1px var(--om-space-xs);
        border-radius: var(--om-radius-sm);
      }
      .trace:hover {
        background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.1));
      }
      .chart {
        width: 100%;
        min-height: 280px;
        margin-top: var(--om-space-sm);
      }
    `,
  ];

  @property({ type: Number }) cardIndex = 0;
  @property({ attribute: false }) card: PlotCard = { kind: "plot" };
  @property({ attribute: false }) results: ResultRef[] = [];
  @property({ attribute: false }) traces: TracePayload[] = [];
  @property({ attribute: false }) variablesByResult: Record<string, string[]> = {};

  private chart: echarts.ECharts | undefined;
  private resizeObserver: ResizeObserver | undefined;

  override firstUpdated(): void {
    const el = this.renderRoot.querySelector<HTMLElement>(".chart");
    if (!el) return;
    this.chart = echarts.init(el);
    this.applyOption();
    this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
    this.resizeObserver.observe(el);
  }

  override updated(changed: PropertyValues): void {
    if (changed.has("traces")) this.applyOption();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
    this.chart = undefined;
  }

  /** Re-read the theme each time so plots track the editor colour theme. */
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
        <button
          class="icon-btn"
          title="Delete plot"
          @click=${() =>
            fireEvent(this, "om-delete-plot", { cardIndex: this.cardIndex })}
        >
          ✕
        </button>
      </header>
      ${traceRows.map(
        (tr, i) => html`
          <div class="trace">
            <span>${this.resultLabel(tr.result)} / ${tr.variable}</span>
            <button
              class="icon-btn"
              title="Remove trace"
              @click=${() =>
                fireEvent(this, "om-remove-trace", {
                  cardIndex: this.cardIndex,
                  traceIndex: i,
                })}
            >
              ✕
            </button>
          </div>
        `,
      )}
      <om-add-trace-row
        .cardIndex=${this.cardIndex}
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
