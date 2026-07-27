import { describe, expect, it } from "vitest";

import "../src/parameter-form/parameter-panel.component.js";

/**
 * Only the closed state is reachable here: opening mounts
 * `<om-parameter-form>`, whose actions are form-associated `wa-button`s that
 * crash happy-dom on connect. The open panel's close paths are covered in
 * `e2e/parameter-panel.spec.ts`.
 */
describe("<om-parameter-panel>", () => {
  it("keeps <om-parameter-form> unmounted while closed", async () => {
    const el = document.createElement("om-parameter-panel");
    document.body.append(el);
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector(".card")).toBeNull();
    expect(el.shadowRoot?.querySelector("om-parameter-form")).toBeNull();
  });
});
