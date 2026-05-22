import { describe, expect, it } from "vitest";

import "./results-drawer.component.js";
import type { OmResultsDrawer } from "./results-drawer.component.js";
import type { AddResultDetail, RemoveResultDetail } from "./events.js";
import type { ResultRef } from "./types.js";

async function mount(results: ResultRef[]): Promise<OmResultsDrawer> {
  const el = document.createElement("om-results-drawer");
  el.results = results;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const result: ResultRef = {
  id: "r1",
  label: "Run 1",
  path: "a.mat",
  source: "simulate",
};

describe("om-results-drawer", () => {
  it("shows the empty state and no chips when there are no results", async () => {
    const el = await mount([]);
    expect(el.shadowRoot!.querySelector(".empty")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".chip")).toBeNull();
  });

  it("renders one chip per result", async () => {
    const el = await mount([result, { ...result, id: "r2", label: "Run 2" }]);
    expect(el.shadowRoot!.querySelectorAll(".chip")).toHaveLength(2);
  });

  it("emits om-add-result with the matching via for each add button", async () => {
    const el = await mount([]);
    const added: AddResultDetail[] = [];
    el.addEventListener("om-add-result", (e) => {
      added.push((e as CustomEvent<AddResultDetail>).detail);
    });
    el.shadowRoot!
      .querySelector<HTMLButtonElement>("button[title='Add a .mat result file']")!
      .click();
    el.shadowRoot!
      .querySelector<HTMLButtonElement>(
        "button[title='Add from the workspace .modelica cache']",
      )!
      .click();
    expect(added).toEqual([{ via: "import" }, { via: "cache" }]);
  });

  it("emits om-remove-result with the chip's id", async () => {
    const el = await mount([result]);
    let removed: RemoveResultDetail | undefined;
    el.addEventListener("om-remove-result", (e) => {
      removed = (e as CustomEvent<RemoveResultDetail>).detail;
    });
    el.shadowRoot!.querySelector<HTMLElement>(".remove")!.click();
    expect(removed).toEqual({ resultId: "r1" });
  });
});
