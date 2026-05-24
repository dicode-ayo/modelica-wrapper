/**
 * `<om-result-view-mock-host>` — a stateful stand-in for the extension host, for
 * Storybook. It holds a mutable `ResultViewDoc` + variable catalog + trace data
 * and responds to the components' `om-*` events the way the real
 * `ResultViewEditorProvider` does — but in-memory and with synthesised
 * trajectories, so the whole interaction loop is exercisable without OMC or
 * VSCode (add/delete plots, add/remove traces, lazy variable lookup, add/remove
 * results). Story-only infra; not part of the package surface.
 *
 * The doc edits here deliberately re-implement the host's transforms (the real
 * ones live in the extension's `result-doc.ts`, tested there). `result-ui` stays
 * independent of the extension, so they can't be shared — this is a stand-in,
 * and re-implementing host behaviour is its whole point.
 */

import { LitElement, html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

import "../src/index.js"; // registers <om-result-view-app> + children
import type {
  AddPlotDetail,
  AddResultDetail,
  AddTraceDetail,
  DeletePlotDetail,
  RemoveResultDetail,
  RemoveTraceDetail,
  RenameResultDetail,
  RequestVariablesDetail,
} from "../src/events.js";
import type { ResultViewDoc, TracePayload } from "../src/types.js";
import {
  sampleDoc,
  sampleTraceData,
  sampleVariablesByResult,
} from "./fixtures/sample.js";

const DEFAULT_VARS = ["time", "x", "y", "der(x)"];

/** Deterministic fake trajectory so a chart visibly changes when traces change. */
function synth(name: string, seed: number): TracePayload {
  const t: number[] = [];
  const values: number[] = [];
  const freq = 3 + (seed % 5);
  const amp = 0.4 + (seed % 3) * 0.2;
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    t.push(x);
    values.push(amp * Math.sin(freq * 6 * x) + seed * 0.05);
  }
  return { t, values, name };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

@customElement("om-result-view-mock-host")
export class ResultViewMockHost extends LitElement {
  @state() private doc: ResultViewDoc = clone(sampleDoc);
  @state() private traceData: Record<string, TracePayload[]> = clone(sampleTraceData);
  @state() private variablesByResult: Record<string, string[]> = { ...sampleVariablesByResult };

  private cardSeq = 0;
  private importSeq = 0;

  private labelFor(resultId: string): string {
    return this.doc.results.find((r) => r.id === resultId)?.label ?? resultId;
  }

  private varsFor(resultId: string): string[] {
    return sampleVariablesByResult[resultId] ?? DEFAULT_VARS;
  }

  /** Rebuild a card's synthesised trace data from its (still-valid) traces. */
  private rebuildCard(cardId: string): void {
    const card = this.doc.cards.find((c) => c.id === cardId);
    if (!card) {
      const next = { ...this.traceData };
      delete next[cardId];
      this.traceData = next;
      return;
    }
    const known = new Set(this.doc.results.map((r) => r.id));
    const payloads = (card.traces ?? [])
      .filter((tr) => known.has(tr.result))
      .map((tr, i) =>
        synth(`${this.labelFor(tr.result)} / ${tr.variable}`, i + tr.variable.length),
      );
    this.traceData = { ...this.traceData, [cardId]: payloads };
  }

  private onAddPlot = (e: CustomEvent<AddPlotDetail>): void => {
    const { afterIndex } = e.detail;
    const cards = [...this.doc.cards];
    cards.splice(afterIndex + 1, 0, {
      kind: "plot",
      id: `mock-card-${++this.cardSeq}`,
      title: `Plot ${cards.length + 1}`,
    });
    this.doc = { ...this.doc, cards };
  };

  private onDeletePlot = (e: CustomEvent<DeletePlotDetail>): void => {
    const { cardId } = e.detail;
    this.doc = { ...this.doc, cards: this.doc.cards.filter((c) => c.id !== cardId) };
    this.rebuildCard(cardId);
  };

  private onAddTrace = (e: CustomEvent<AddTraceDetail>): void => {
    const { cardId, resultId, variable } = e.detail;
    this.doc = {
      ...this.doc,
      cards: this.doc.cards.map((c) =>
        c.id === cardId
          ? { ...c, traces: [...(c.traces ?? []), { result: resultId, variable }] }
          : c,
      ),
    };
    this.rebuildCard(cardId);
  };

  private onRemoveTrace = (e: CustomEvent<RemoveTraceDetail>): void => {
    const { cardId, traceIndex } = e.detail;
    this.doc = {
      ...this.doc,
      cards: this.doc.cards.map((c) =>
        c.id === cardId
          ? { ...c, traces: (c.traces ?? []).filter((_, i) => i !== traceIndex) }
          : c,
      ),
    };
    this.rebuildCard(cardId);
  };

  private onRequestVariables = (e: CustomEvent<RequestVariablesDetail>): void => {
    const { resultId } = e.detail;
    // Mimic the host's lazy reply (a tick of latency).
    setTimeout(() => {
      this.variablesByResult = {
        ...this.variablesByResult,
        [resultId]: this.varsFor(resultId),
      };
    }, 150);
  };

  private onAddResult = (e: CustomEvent<AddResultDetail>): void => {
    const { via } = e.detail;
    const id = `mock-result-${++this.importSeq}`;
    this.doc = {
      ...this.doc,
      results: [
        ...this.doc.results,
        {
          id,
          label: `${via === "cache" ? "cache" : "import"}-${this.importSeq}`,
          path: `${id}.mat`,
          source: via,
          createdAt: new Date().toISOString(),
        },
      ],
    };
  };

  private onRemoveResult = (e: CustomEvent<RemoveResultDetail>): void => {
    const { resultId } = e.detail;
    this.doc = {
      ...this.doc,
      results: this.doc.results.filter((r) => r.id !== resultId),
      cards: this.doc.cards.map((c) => ({
        ...c,
        traces: (c.traces ?? []).filter((t) => t.result !== resultId),
      })),
    };
    for (const c of this.doc.cards) this.rebuildCard(c.id);
  };

  private onRenameResult = (e: CustomEvent<RenameResultDetail>): void => {
    const { resultId, label } = e.detail;
    this.doc = {
      ...this.doc,
      results: this.doc.results.map((r) => (r.id === resultId ? { ...r, label } : r)),
    };
  };

  override render(): TemplateResult {
    return html`
      <om-result-view-app
        .doc=${this.doc}
        .traceData=${this.traceData}
        .variablesByResult=${this.variablesByResult}
        @om-add-plot=${this.onAddPlot}
        @om-delete-plot=${this.onDeletePlot}
        @om-add-trace=${this.onAddTrace}
        @om-remove-trace=${this.onRemoveTrace}
        @om-request-variables=${this.onRequestVariables}
        @om-add-result=${this.onAddResult}
        @om-remove-result=${this.onRemoveResult}
        @om-rename-result=${this.onRenameResult}
      ></om-result-view-app>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-result-view-mock-host": ResultViewMockHost;
  }
}
