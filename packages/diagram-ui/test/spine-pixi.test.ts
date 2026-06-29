import { afterEach, describe, expect, it } from "vitest";
import { Graphics } from "pixi.js";

import "../src/scene/scene.component.js";
import type { OmScene } from "../src/scene/scene.component.js";

// FALLBACK_CANVAS_* — happy-dom has no layout, so getBoundingClientRect
// is 0 and the scene falls back to 800x600.
const W = 800;
const H = 600;

async function mountScene(props: Partial<OmScene>): Promise<OmScene> {
  const el = document.createElement("om-scene") as OmScene;
  // Renderer-less: build the Pixi scene graph on the CPU, no GPU context.
  el.rendererFactory = () => null;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function contextOf(el: OmScene): NonNullable<OmScene["sceneContextValue"]> {
  const ctx = el.sceneContextValue;
  if (ctx === null) {
    throw new Error("scene context not ready");
  }
  return ctx;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("<om-scene> Pixi spine", () => {
  it("provides a scene context with container roots once mounted", async () => {
    const el = await mountScene({ zoom: 100 });
    const ctx = el.sceneContextValue;
    expect(ctx).not.toBeNull();
    expect(ctx?.renderer).toBeNull();
    expect(ctx?.stage.label).toBe("om-stage");
    expect(ctx?.worldRoot.label).toBe("om-world");
    expect(ctx?.diagramRoot.label).toBe("om-diagram");
  });

  it("maps the view onto worldRoot: ppu scale (y-flipped) and centred pan", async () => {
    const el = await mountScene({ zoom: 100, panX: 0, panY: 0 });
    const world = contextOf(el).worldRoot;
    const ppu = H / (2 * 100); // = 3
    expect(world.scale.x).toBeCloseTo(ppu, 5);
    expect(world.scale.y).toBeCloseTo(-ppu, 5);
    expect(world.position.x).toBeCloseTo(W / 2, 5);
    expect(world.position.y).toBeCloseTo(H / 2, 5);
  });

  it("offsets worldRoot position by pan", async () => {
    const el = await mountScene({ zoom: 100, panX: 10, panY: 20 });
    const world = contextOf(el).worldRoot;
    const ppu = 3;
    expect(world.position.x).toBeCloseTo(W / 2 - 10 * ppu, 5);
    expect(world.position.y).toBeCloseTo(H / 2 + 20 * ppu, 5);
  });

  it("picks the topmost interactive container at a canvas point", async () => {
    const el = await mountScene({ zoom: 100 });
    const ctx = contextOf(el);
    const box = new Graphics({ label: "hit-box" });
    box.rect(-50, -50, 100, 100).fill(0x3366cc);
    box.eventMode = "static";
    ctx.diagramRoot.addChild(box);

    // Diagram (0,0) projects to the canvas centre (W/2, H/2).
    expect(ctx.pick(W / 2, H / 2)).toBe(box);
    // A point well outside the box hits nothing.
    expect(ctx.pick(5, 5)).toBeNull();
  });
});
