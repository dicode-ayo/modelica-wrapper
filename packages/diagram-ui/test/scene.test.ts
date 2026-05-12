import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core";

import "../src/scene/scene.component.js";
import type { OmScene } from "../src/scene/scene.component.js";

/**
 * Tests run under happy-dom and Babylon's `NullEngine`, so no WebGL is
 * required. We exercise mount → context exposure → unmount, plus
 * property → camera-state propagation. The visual surface is covered
 * by the Storybook story.
 */

function makeNullEngine(): NullEngine {
  return new NullEngine({
    renderWidth: 640,
    renderHeight: 480,
    textureSize: 256,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
}

let mounted: OmScene[] = [];

async function mountScene(): Promise<OmScene> {
  const el = document.createElement("om-scene") as OmScene;
  el.engineFactory = () => makeNullEngine();
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

  it("exposes scene + camera + transform nodes through the Lit context after mount", async () => {
    const el = await mountScene();
    const ctx = el.sceneContextValue;
    expect(ctx).not.toBeNull();
    expect(ctx?.scene).toBeDefined();
    expect(ctx?.camera).toBeDefined();
    expect(ctx?.worldRoot).toBeDefined();
    expect(ctx?.diagramRoot).toBeDefined();
    expect(ctx?.diagramRoot.parent).toBe(ctx?.worldRoot);
  });

  it("configures an orthographic camera looking at the XY plane", async () => {
    const el = await mountScene();
    const camera = el.sceneContextValue?.camera;
    expect(camera).toBeDefined();
    // ORTHOGRAPHIC_CAMERA mode is the integer constant 1 in Babylon.
    expect(camera?.mode).toBe(1);
    // α = -π/2, β = π/2 puts the camera on -Z looking toward +Z. That
    // orientation gives Babylon's left-handed view matrix a right-vector
    // of +X, so world +X renders at screen-right (mirror-free) and drag
    // direction matches mouse direction.
    expect(camera?.alpha).toBeCloseTo(-Math.PI / 2);
    expect(camera?.beta).toBeCloseTo(Math.PI / 2);
  });

  it("recomputes ortho extents when zoom / pan change", async () => {
    const el = await mountScene();
    el.zoom = 50;
    el.panX = 25;
    el.panY = -10;
    await el.updateComplete;
    const camera = el.sceneContextValue?.camera;
    expect(camera?.orthoTop).toBeCloseTo(50);
    expect(camera?.orthoBottom).toBeCloseTo(-50);
    expect(camera?.target.x).toBeCloseTo(25);
    expect(camera?.target.y).toBeCloseTo(-10);
  });

  it("disposes the Babylon scene + engine on disconnect", async () => {
    const el = await mountScene();
    const scene = el.sceneContextValue?.scene;
    el.remove();
    expect(el.sceneContextValue).toBeNull();
    // Babylon marks disposed scenes with `isDisposed = true`.
    expect(scene?.isDisposed).toBe(true);
  });

  it("clientToDiagram maps the canvas centre to (panX, panY)", async () => {
    const el = await mountScene();
    el.zoom = 100;
    el.panX = 5;
    el.panY = -3;
    await el.updateComplete;
    const canvas = el.shadowRoot!.querySelector("canvas")!;
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
    expect(pt!.x).toBeCloseTo(5);
    expect(pt!.y).toBeCloseTo(-3);
  });

  it("emits om-view-change events when PanZoom updates the view", async () => {
    const el = await mountScene();
    const canvas = el.shadowRoot!.querySelector("canvas")!;
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
    let received: { zoom: number; panX: number; panY: number } | null = null;
    el.addEventListener("om-view-change", (e) => {
      received = (e as CustomEvent).detail;
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
    expect(received).not.toBeNull();
    expect(received!.zoom).toBeLessThan(100);
  });
});
