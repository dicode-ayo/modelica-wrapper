import { afterEach, describe, expect, it } from "vitest";

import "../src/context-menu/context-menu.component.js";
import type {
  ContextMenuItem,
  OmContextMenu,
} from "../src/context-menu/context-menu.component.js";

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) t();
});

async function mount(items: ContextMenuItem[]): Promise<OmContextMenu> {
  const el = document.createElement("om-context-menu") as OmContextMenu;
  el.items = items;
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  return el;
}

function menuButtons(el: OmContextMenu): HTMLButtonElement[] {
  return [...(el.shadowRoot?.querySelectorAll("button") ?? [])];
}

const ITEMS: ContextMenuItem[] = [
  { id: "del", label: "Delete", group: "edit" },
  { id: "rot", label: "Rotate", group: "transform" },
  { id: "flip", label: "Flip", group: "transform", disabled: true },
];

describe("<om-context-menu>", () => {
  it("renders nothing until opened", async () => {
    const el = await mount(ITEMS);
    expect(menuButtons(el)).toHaveLength(0);
  });

  it("renders the items in order once opened", async () => {
    const el = await mount(ITEMS);
    el.open(10, 20);
    await el.updateComplete;
    expect(menuButtons(el).map((b) => b.textContent?.trim())).toEqual([
      "Delete",
      "Rotate",
      "Flip",
    ]);
  });

  it("draws a separator between groups", async () => {
    const el = await mount(ITEMS);
    el.open(0, 0);
    await el.updateComplete;
    // edit → transform boundary = exactly one separator.
    expect(el.shadowRoot?.querySelectorAll("hr")).toHaveLength(1);
  });

  it("emits select with the item id and closes on click", async () => {
    const el = await mount(ITEMS);
    el.open(0, 0);
    await el.updateComplete;
    const picked: string[] = [];
    el.addEventListener("om-context-menu-select", (e) =>
      picked.push((e as CustomEvent<{ id: string }>).detail.id),
    );

    menuButtons(el)[0]?.click();
    await el.updateComplete;

    expect(picked).toEqual(["del"]);
    expect(menuButtons(el)).toHaveLength(0);
  });

  it("does not select a disabled item", async () => {
    const el = await mount(ITEMS);
    el.open(0, 0);
    await el.updateComplete;
    let fired = false;
    el.addEventListener("om-context-menu-select", () => (fired = true));
    menuButtons(el)[2]?.click();
    expect(fired).toBe(false);
  });

  it("closes and emits close on Escape", async () => {
    const el = await mount(ITEMS);
    el.open(0, 0);
    await el.updateComplete;
    let closed = false;
    el.addEventListener("om-context-menu-close", () => (closed = true));

    el.shadowRoot
      ?.querySelector("[role='menu']")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    await el.updateComplete;

    expect(closed).toBe(true);
    expect(menuButtons(el)).toHaveLength(0);
  });

  it("closes on an outside pointerdown", async () => {
    const el = await mount(ITEMS);
    el.open(0, 0);
    await el.updateComplete;

    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    await el.updateComplete;

    expect(menuButtons(el)).toHaveLength(0);
  });
});
