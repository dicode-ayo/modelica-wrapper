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
    // alpha = beta = π/2 puts the camera on +Z looking at the origin,
    // making the XY plane the diagram plane.
    expect(camera?.alpha).toBeCloseTo(Math.PI / 2);
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
});
