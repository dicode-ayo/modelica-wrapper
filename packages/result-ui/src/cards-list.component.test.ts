import { describe, expect, it } from "vitest";

import "./cards-list.component.js";
import type { OmCardsList } from "./cards-list.component.js";
import type { AddPlotDetail } from "./events.js";

// The empty state is exercised here because it emits `om-add-plot` without
// mounting any `<om-result-plot-card>` — those init ECharts in `firstUpdated`,
// which needs a real canvas happy-dom doesn't provide. The populated list is
// covered visually in Storybook.

async function mount(cards: OmCardsList["cards"]): Promise<OmCardsList> {
  const el = document.createElement("om-cards-list");
  el.cards = cards;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("om-cards-list", () => {
  it("shows the empty state when there are no cards", async () => {
    const el = await mount([]);
    expect(el.shadowRoot!.querySelector(".empty")).not.toBeNull();
  });

  it("emits om-add-plot at the top from the empty state", async () => {
    const el = await mount([]);
    let added: AddPlotDetail | undefined;
    el.addEventListener("om-add-plot", (e) => {
      added = (e as CustomEvent<AddPlotDetail>).detail;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>(".empty button")!.click();
    expect(added).toEqual({ afterIndex: -1 });
  });
});
