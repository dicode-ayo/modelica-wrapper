import { describe, expect, it } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";
import { mountLayout } from "./harness/interaction-fixtures.js";
import { emptyLayout } from "./harness/layout-fixtures.js";

function tinyLayout(): DiagramLayout {
  return {
    ...emptyLayout(),
    className: "T",
    classes: {
      "Test.Block": {
        name: "Test.Block",
        restriction: "block",
        iconLayers: [{ from: "Test.Block", shapes: [] }],
        connectors: {},
        parameters: {},
      },
    },
    components: {
      b1: {
        name: "b1",
        classRef: "Test.Block",
        placement: {
          extent: [
            [-10, -5],
            [10, 5],
          ],
        },
      },
    },
  };
}

describe("<om-graphical-layout>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-graphical-layout")).toBeDefined();
  });

  it("renders one <om-component> per layout component", async () => {
    const el = await mountLayout({ layout: tinyLayout() });
    // Dump for diagnostic; the assertion message embeds the HTML so a
    // future regression points straight at the offending render output.
    const shadowRoot = el.shadowRoot;
    if (!shadowRoot) throw new Error("no shadowRoot");
    const inner = shadowRoot.innerHTML;
    const comps = shadowRoot.querySelectorAll("om-component");
    expect(
      comps.length,
      `expected 1 om-component in shadow HTML: ${inner}`,
    ).toBe(1);
  });

  it("renders a host diagram Text once, world-space — no <om-label> for layout.labels", async () => {
    // `labels` mirrors the host's diagram `Text` annotations, which render
    // through the host shape layers as `<om-text>` (extent-sized, zoom
    // tracking). An `<om-label>` copy would draw the text a second time in
    // screen space — and at fontSize 0 an invisible one.
    const layout: DiagramLayout = {
      ...emptyLayout(),
      className: "T",
      diagramLayers: [
        {
          from: "T",
          shapes: [
            {
              kind: "text",
              extent: [
                [-100, -20],
                [100, 20],
              ],
              textString: "reference speed",
            },
          ],
        },
      ],
      labels: [
        {
          text: "reference speed",
          extent: [
            [-100, -20],
            [100, 20],
          ],
          rotation: 0,
          fontSize: 0,
        },
      ],
    };
    const el = await mountLayout({ layout });
    const shadowRoot = el.shadowRoot;
    if (!shadowRoot) throw new Error("no shadowRoot");
    expect(shadowRoot.querySelectorAll("om-label")).toHaveLength(0);
    expect(shadowRoot.querySelectorAll("om-text")).toHaveLength(1);
  });

  it("does not render a component whose placement hides it", async () => {
    const layout = tinyLayout();
    const b1 = layout.components["b1"];
    if (b1 === undefined) throw new Error("expected b1 in the layout");
    layout.components["b2"] = {
      ...b1,
      name: "b2",
      placement: { ...b1.placement, visible: false },
    };
    const el = await mountLayout({ layout });
    const comps = el.shadowRoot?.querySelectorAll("om-component");
    expect(comps?.length).toBe(1);
    expect((comps?.[0] as { nodeId?: string }).nodeId).toBe("b1");
  });

  it("still routes a connection anchored to a hidden component's port", async () => {
    const layout = tinyLayout();
    const b1 = layout.components["b1"];
    if (b1 === undefined) throw new Error("expected b1 in the layout");
    layout.components["b1"] = {
      ...b1,
      placement: { ...b1.placement, visible: false },
    };
    layout.connections = [
      {
        lhs: { component: "b1", port: "y" },
        rhs: { component: "b1", port: "u" },
        waypoints: [
          [-10, 0],
          [10, 0],
        ],
      },
    ];
    const el = await mountLayout({ layout });
    expect(el.shadowRoot?.querySelectorAll("om-component").length).toBe(0);
    expect(el.shadowRoot?.querySelectorAll("om-connection").length).toBe(1);
  });

  it("forwards a connection's annotation color to its <om-edge> stroke", async () => {
    const layout = tinyLayout();
    layout.connections = [
      {
        lhs: { component: "b1", port: "y" },
        rhs: { component: "b1", port: "u" },
        waypoints: [
          [-10, 0],
          [10, 0],
        ],
        color: [0, 0, 127],
      },
      {
        lhs: { component: "b1", port: "y" },
        rhs: { component: "b1", port: "u" },
        waypoints: [
          [-10, 5],
          [10, 5],
        ],
      },
      {
        lhs: { component: "b1", port: "y" },
        rhs: { component: "b1", port: "u" },
        waypoints: [
          [-10, 10],
          [10, 10],
        ],
        // Out-of-range / fractional channels clamp + round to a valid colour.
        color: [300, 15.6, -4],
      },
    ];
    const el = await mountLayout({ layout });
    const conns = el.shadowRoot?.querySelectorAll("om-connection");
    expect(conns?.length).toBe(3);
    expect((conns?.[0] as { stroke?: string }).stroke).toBe("rgb(0,0,127)");
    expect((conns?.[1] as { stroke?: string }).stroke).toBeUndefined();
    expect((conns?.[2] as { stroke?: string }).stroke).toBe("rgb(255,16,0)");
  });

  it("tracks selection via setSelection / selection", async () => {
    const el = await mountLayout({ layout: tinyLayout() });
    el.setSelection(["c:b1"]);
    expect(el.selection).toEqual(["c:b1"]);
    el.setSelection([]);
    expect(el.selection).toEqual([]);
  });

  it("ignores invalid selection keys", async () => {
    const el = await mountLayout({ layout: tinyLayout() });
    el.setSelection(["bogus", "c:b1"]);
    expect(el.selection).toEqual(["c:b1"]);
  });

  it("rotateSelection rotates the selection by 90° and emits a change", async () => {
    const el = await mountLayout({ layout: tinyLayout() });
    el.setSelection(["c:b1"]);
    const changes: DiagramLayout[] = [];
    el.addEventListener("om-graphical-layout-change", (e) => {
      changes.push((e as CustomEvent<DiagramLayout>).detail);
    });

    el.rotateSelection(true);

    expect(changes).toHaveLength(1);
    const b1 = changes.at(-1)?.components["b1"];
    if (b1 === undefined) throw new Error("expected b1 in the layout");
    expect(b1.placement.rotation).toBe(270);
  });

  it("flipSelection mirrors the selection's extent horizontally", async () => {
    const el = await mountLayout({ layout: tinyLayout() });
    el.setSelection(["c:b1"]);
    const changes: DiagramLayout[] = [];
    el.addEventListener("om-graphical-layout-change", (e) => {
      changes.push((e as CustomEvent<DiagramLayout>).detail);
    });

    el.flipSelection(true);

    expect(changes).toHaveLength(1);
    const b1 = changes.at(-1)?.components["b1"];
    if (b1 === undefined) throw new Error("expected b1 in the layout");
    expect(b1.placement.extent).toEqual([
      [10, -5],
      [-10, 5],
    ]);
  });

  it("rotateSelection is a no-op with no selection", async () => {
    const el = await mountLayout({ layout: tinyLayout() });
    let fired = false;
    el.addEventListener("om-graphical-layout-change", () => {
      fired = true;
    });
    el.rotateSelection(true);
    expect(fired).toBe(false);
  });

  function sceneOf(el: OmGraphicalLayout): Element {
    const scene = el.shadowRoot?.querySelector("om-scene");
    if (!scene) throw new Error("expected an <om-scene>");
    return scene;
  }

  const keydown = (key: string): KeyboardEvent =>
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });

  it("dispatches a bound key through the registry and prevents default", async () => {
    const el = await mountLayout({ layout: tinyLayout() });
    el.setSelection(["c:b1"]);
    const changes: DiagramLayout[] = [];
    el.addEventListener("om-graphical-layout-change", (e) => {
      changes.push((e as CustomEvent<DiagramLayout>).detail);
    });

    const ev = keydown("Delete");
    sceneOf(el).dispatchEvent(ev);

    expect(changes).toHaveLength(1);
    expect(changes.at(-1)?.components["b1"]).toBeUndefined();
    expect(ev.defaultPrevented).toBe(true);
  });

  it("lets an unbound key fall through without preventing default", async () => {
    const el = await mountLayout({ layout: tinyLayout() });
    el.setSelection(["c:b1"]);
    const ev = keydown("z");
    sceneOf(el).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("does not prevent default when a bound key's command is disabled", async () => {
    const el = await mountLayout({ layout: tinyLayout() });
    // No selection → `diagram.delete`'s `when` fails → key falls through.
    const ev = keydown("Delete");
    sceneOf(el).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("mounts an <om-context-menu> for right-click commands", async () => {
    // The right-click → menu → run-command flow is verified end-to-end in a
    // real browser (Storybook); happy-dom can't bind a Lit `@`-listener on a
    // custom element or drive the canvas pointer interaction.
    const el = await mountLayout({ layout: tinyLayout() });
    expect(el.shadowRoot?.querySelector("om-context-menu")).not.toBeNull();
  });

  it("routes the hasClipboard property into the command context", async () => {
    // The property is pushed by the host (the clipboard is shared across
    // editors), and this is the only thing that makes paste reachable.
    const el = await mountLayout({ layout: tinyLayout() });
    const requests: unknown[] = [];
    el.addEventListener("om-clipboard-request", (e) =>
      requests.push((e as CustomEvent<unknown>).detail),
    );

    expect(el.runCommandById("diagram.paste")).toBe(false);

    el.hasClipboard = true;
    await el.updateComplete;

    expect(el.runCommandById("diagram.paste")).toBe(true);
    expect(requests).toEqual([{ action: "paste" }]);
  });

  it("mounts an <om-keymap-help> for the ? shortcut", async () => {
    // Dispatching Shift+? for real (and asserting the open state it drives)
    // is verified end-to-end in a real browser (Storybook): `<wa-dialog>`'s
    // internal close button is a form-associated `wa-button`, which
    // crashes happy-dom on connect, so this only pins that the element is
    // mounted and starts closed; `shift+?`'s dispatch is pinned at the
    // registry/keymap level instead (`test/keymap.test.ts`,
    // `test/diagram-commands.test.ts`).
    const el = await mountLayout({ layout: tinyLayout() });
    const help = el.shadowRoot?.querySelector("om-keymap-help") as
      (HTMLElement & { open: boolean }) | null;
    expect(help).not.toBeNull();
    expect(help?.open).toBe(false);
  });
});
