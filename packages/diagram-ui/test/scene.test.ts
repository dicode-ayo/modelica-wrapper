import { afterEach, describe, expect, it } from "vitest";

import "../src/scene/scene.component.js";
import type { OmScene } from "../src/scene/scene.component.js";

/**
 * Tests run under happy-dom with a renderer-less Pixi scene graph, so no
 * WebGL is required. We exercise mount → context exposure → unmount, plus
 * property → view-transform propagation.
 */

// happy-dom has no layout, so getBoundingClientRect is 0 and the scene
// falls back to FALLBACK_CANVAS_* (800x600).
const W = 800;
const H = 600;

let mounted: OmScene[] = [];

async function mountScene(): Promise<OmScene> {
  const el = document.createElement("om-scene") as OmScene;
  // Renderer-less: build the Pixi scene graph on the CPU, no GPU context.
  el.rendererFactory = () => null;
  document.body.appendChild(el);
  // Wait for firstUpdated → mount() to run.
  await el.updateComplete;
  mounted.push(el);
  return el;
}

afterEach(() => {
  for (const el of mounted) {
    el.remove();
  }
  mounted = [];
});

describe("<om-scene>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-scene")).toBeDefined();
  });

  it("exposes the renderer-less context with its container roots after mount", async () => {
    const el = await mountScene();
    const ctx = el.sceneContextValue;
    expect(ctx).not.toBeNull();
    expect(ctx?.renderer).toBeNull();
    expect(ctx?.stage.label).toBe("om-stage");
    expect(ctx?.worldRoot.label).toBe("om-world");
    expect(ctx?.diagramRoot.label).toBe("om-diagram");
    expect(ctx?.diagramRoot.parent).toBe(ctx?.worldRoot);
  });

  it("flips Y on worldRoot so diagram +y renders screen-up", async () => {
    const el = await mountScene();
    const world = el.sceneContextValue?.worldRoot;
    expect(world).toBeDefined();
    // Modelica +y-up under a native +y-down canvas means exactly one
    // negative-Y scale on the world transform; X stays positive so +x is
    // screen-right (mirror-free, matching mouse drag direction).
    if (!world) throw new Error("no worldRoot");
    expect(world.scale.x).toBeGreaterThan(0);
    expect(world.scale.y).toBeLessThan(0);
  });

  it("recomputes the world transform when zoom / pan change", async () => {
    const el = await mountScene();
    el.zoom = 50;
    el.panX = 25;
    el.panY = -10;
    await el.updateComplete;
    const world = el.sceneContextValue?.worldRoot;
    if (!world) throw new Error("no worldRoot");
    const ppu = H / (2 * 50); // = 6
    expect(world.scale.x).toBeCloseTo(ppu, 5);
    expect(world.scale.y).toBeCloseTo(-ppu, 5);
    expect(world.position.x).toBeCloseTo(W / 2 - 25 * ppu, 5);
    expect(world.position.y).toBeCloseTo(H / 2 + -10 * ppu, 5);
  });

  it("disposes the Pixi stage on disconnect", async () => {
    const el = await mountScene();
    const stage = el.sceneContextValue?.stage;
    el.remove();
    expect(el.sceneContextValue).toBeNull();
    expect(stage?.destroyed).toBe(true);
  });

  it("clientToDiagram maps the canvas centre to (panX, panY)", async () => {
    const el = await mountScene();
    el.zoom = 100;
    el.panX = 5;
    el.panY = -3;
    await el.updateComplete;
    const shadowRoot = el.shadowRoot;
    if (!shadowRoot) throw new Error("no shadowRoot");
    const canvas = shadowRoot.querySelector("canvas");
    if (!canvas) throw new Error("no canvas");
    canvas.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 400,
        width: 800,
        height: 400,
        toJSON: () => ({}),
      }) as DOMRect;
    const pt = el.clientToDiagram(400, 200);
    expect(pt).not.toBeNull();
    if (pt === null) throw new Error("pt is null");
    expect(pt.x).toBeCloseTo(5);
    expect(pt.y).toBeCloseTo(-3);
  });

  it("emits om-view-change events when PanZoom updates the view", async () => {
    const el = await mountScene();
    const shadowRoot = el.shadowRoot;
    if (!shadowRoot) throw new Error("no shadowRoot");
    const canvas = shadowRoot.querySelector("canvas");
    if (!canvas) throw new Error("no canvas");
    canvas.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 400,
        width: 800,
        height: 400,
        toJSON: () => ({}),
      }) as DOMRect;
    const received: { zoom: number; panX: number; panY: number }[] = [];
    el.addEventListener("om-view-change", (e) => {
      received.push((e as CustomEvent).detail);
    });
    // Wheel with ctrlKey to trigger the zoom path (plain wheel is
    // pan after the touchpad-friendly rebinding). happy-dom drops
    // modifier keys from the constructor init, so we patch the event
    // after construction.
    const e = new WheelEvent("wheel", {
      deltaY: -100,
      clientX: 400,
      clientY: 200,
    });
    Object.defineProperty(e, "ctrlKey", { value: true });
    canvas.dispatchEvent(e);
    const last = received.at(-1);
    if (last === undefined) throw new Error("received is null");
    expect(last.zoom).toBeLessThan(100);
  });
});
