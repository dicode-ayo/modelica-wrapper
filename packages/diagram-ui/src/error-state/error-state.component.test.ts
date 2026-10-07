import { afterEach, describe, expect, it, vi } from "vitest";

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

  describe("long detail", () => {
    const longDetail = Array.from({ length: 8 }, (_, i) => `line ${i}`).join(
      "\n",
    );

    it("is collapsed by default behind an aria-expanded toggle", async () => {
      const el = await mount({ heading: "Boom", detail: longDetail });
      const root = el.shadowRoot;
      expect(root?.querySelector(".detail")).toBeNull();
      const toggle = root?.querySelector<HTMLButtonElement>("button.toggle");
      expect(toggle?.textContent?.trim()).toBe("Show details");
      expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    });

    it("toggle reveals and hides the full detail", async () => {
      const el = await mount({ heading: "Boom", detail: longDetail });
      const root = el.shadowRoot;
      root?.querySelector<HTMLButtonElement>("button.toggle")?.click();
      await el.updateComplete;
      expect(root?.querySelector(".detail")?.textContent).toBe(longDetail);
      const toggle = root?.querySelector<HTMLButtonElement>("button.toggle");
      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
      toggle?.click();
      await el.updateComplete;
      expect(root?.querySelector(".detail")).toBeNull();
    });

    it("copy writes the full detail to the clipboard", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      teardowns.push(() => vi.unstubAllGlobals());
      const el = await mount({ heading: "Boom", detail: longDetail });
      el.shadowRoot?.querySelector<HTMLButtonElement>("button.copy")?.click();
      await el.updateComplete;
      expect(writeText).toHaveBeenCalledWith(longDetail);
    });

    it("reports a clipboard failure instead of throwing", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("denied"));
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      teardowns.push(() => vi.unstubAllGlobals());
      const el = await mount({ heading: "Boom", detail: longDetail });
      el.shadowRoot?.querySelector<HTMLButtonElement>("button.copy")?.click();
      await vi.waitFor(async () => {
        await el.updateComplete;
        expect(
          el.shadowRoot?.querySelector("button.copy")?.textContent?.trim(),
        ).toBe("Copy failed");
      });
    });

    it("does not collapse a short detail", async () => {
      const el = await mount({ heading: "Boom", detail: "one\ntwo" });
      expect(el.shadowRoot?.querySelector("button")).toBeNull();
      expect(el.shadowRoot?.querySelector(".detail")?.textContent).toBe(
        "one\ntwo",
      );
    });
  });
});
