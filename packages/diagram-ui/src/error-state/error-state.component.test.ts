import { afterEach, describe, expect, it } from "vitest";

import "./error-state.component.js";
import type { OmErrorState } from "./error-state.component.js";

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) t();
});

async function mount(
  assign: Partial<
    Pick<OmErrorState, "heading" | "subject" | "detail" | "hint">
  >,
): Promise<OmErrorState> {
  const el = document.createElement("om-error-state");
  Object.assign(el, assign);
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  return el;
}

describe("om-error-state", () => {
  it("renders heading, subject, detail, and hint", async () => {
    const el = await mount({
      heading: "Can't render the diagram",
      subject: "Pkg.Broken",
      detail: 'Class "Pkg.Broken" is not fully loaded',
      hint: "Load the enclosing package first.",
    });
    const root = el.shadowRoot;
    expect(root?.querySelector("h2")?.textContent).toBe(
      "Can't render the diagram",
    );
    expect(root?.querySelector("code")?.textContent).toBe("Pkg.Broken");
    expect(root?.querySelector(".detail")?.textContent).toBe(
      'Class "Pkg.Broken" is not fully loaded',
    );
    expect(root?.querySelector(".hint")?.textContent).toBe(
      "Load the enclosing package first.",
    );
  });

  it("omits subject, detail, and hint when empty", async () => {
    const el = await mount({ heading: "Boom" });
    const root = el.shadowRoot;
    expect(root?.querySelector("code")).toBeNull();
    expect(root?.querySelector(".detail")).toBeNull();
    expect(root?.querySelector(".hint")).toBeNull();
  });
});
