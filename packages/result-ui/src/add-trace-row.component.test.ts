import { describe, expect, it } from "vitest";

import "./add-trace-row.component.js";
import type { OmAddTraceRow } from "./add-trace-row.component.js";
import type { RequestVariablesDetail } from "./events.js";

// Note: the cascade selection logic is unit-tested purely in `picker.test.ts`.
// happy-dom doesn't reliably render Lit array-bound <select> elements, so here
// we only cover the mount + result-selection behaviour, which it handles fine.
// The full picker rendering is exercised visually in Storybook.

async function mount(
  results: OmAddTraceRow["results"],
  variablesByResult: Record<string, string[]>,
): Promise<OmAddTraceRow> {
  const el = document.createElement("om-add-trace-row");
  el.results = results;
  el.variablesByResult = variablesByResult;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("om-add-trace-row", () => {
  it("shows a hint and no controls when there are no results", async () => {
    const el = await mount([], {});
    expect(el.shadowRoot!.querySelector("select")).toBeNull();
    expect(el.shadowRoot!.querySelector(".hint")).not.toBeNull();
  });

  it("renders a result select once results are provided", async () => {
    const el = await mount([{ id: "r1", label: "R1", path: "a.mat", source: "import" }], {
      r1: ["time", "motor.w"],
    });
    const sel = el.shadowRoot!.querySelector<HTMLSelectElement>("select[aria-label='Result']");
    expect(sel).not.toBeNull();
    expect([...sel!.options].map((o) => o.value)).toEqual(["", "r1"]);
  });

  it("requests variables when a result with none known is selected", async () => {
    const el = await mount([{ id: "r2", label: "R2", path: "b.mat", source: "import" }], {});
    let asked: RequestVariablesDetail | undefined;
    el.addEventListener("om-request-variables", (e) => {
      asked = (e as CustomEvent<RequestVariablesDetail>).detail;
    });
    const sel = el.shadowRoot!.querySelector<HTMLSelectElement>("select[aria-label='Result']")!;
    sel.value = "r2";
    sel.dispatchEvent(new Event("change"));
    await el.updateComplete;
    expect(asked).toEqual({ resultId: "r2" });
  });
});
