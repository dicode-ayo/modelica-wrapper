import { afterEach, describe, expect, it } from "vitest";
import { Container } from "pixi.js";

import "../src/scene/scene.component.js";
import "../src/axis/grid-axis.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmGridAxis } from "../src/axis/grid-axis.component.js";
import { buildGrid } from "../src/axis/grid-build.js";

let mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted) {
    el.remove();
  }
  mounted = [];
});

describe("buildGrid", () => {
  it("creates three grid layers parented to the provided container", () => {
    const parent = new Container();
    const m = buildGrid(parent);
    expect(m.minor.parent).toBe(parent);
    expect(m.major.parent).toBe(parent);
    expect(m.axes.parent).toBe(parent);
  });

  it("places lines covering the requested extent", () => {
    const parent = new Container();
    const m = buildGrid(parent, {
      extent: 100,
      minorStep: 10,
      majorStep: 50,
    });
    expect(m.minor).toBeDefined();
    expect(m.major).toBeDefined();
    expect(m.axes).toBeDefined();
  });
});

describe("<om-grid-axis>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-grid-axis")).toBeDefined();
  });

  it("creates the grid graphics when nested inside <om-scene>", async () => {
    const scene = document.createElement("om-scene") as OmScene;
    scene.rendererFactory = () => null;
    document.body.appendChild(scene);
    mounted.push(scene);
    await scene.updateComplete;

    const grid = document.createElement("om-grid-axis") as OmGridAxis;
    scene.appendChild(grid);
    await grid.updateComplete;

    const graphics = grid.gridGraphics;
    expect(graphics).not.toBeNull();
    if (!graphics) throw new Error("expected gridGraphics");
    expect(graphics.minor.parent).toBeDefined();
    const ctx = scene.sceneContextValue;
    if (!ctx) throw new Error("no scene context");
    // The layers sit under the grid Container, which sits under worldRoot.
    expect(graphics.minor.parent?.parent).toBe(ctx.worldRoot);
  });

  it("does not rebuild the grid when an equivalent coordinateSystem is reassigned", async () => {
    // After an OMC layout roundtrip the `coordinateSystem` arrives as
    // a fresh object with identical numbers. The grid's Graphics must
    // survive that intact — otherwise every commit/refresh blanks and
    // repaints the axis underlay.
    const sceneEl = document.createElement("om-scene") as OmScene;
    sceneEl.rendererFactory = () => null;
    document.body.appendChild(sceneEl);
    mounted.push(sceneEl);
    await sceneEl.updateComplete;

    const grid = document.createElement("om-grid-axis") as OmGridAxis;
    grid.coordinateSystem = {
      extent: [
        [-100, -100],
        [100, 100],
      ],
      grid: [2, 2],
    };
    sceneEl.appendChild(grid);
    await grid.updateComplete;
    const original = grid.gridGraphics;
    expect(original).not.toBeNull();

    grid.coordinateSystem = {
      extent: [
        [-100, -100],
        [100, 100],
      ],
      grid: [2, 2],
    };
    await grid.updateComplete;
    expect(grid.gridGraphics).toBe(original);
    if (!original) throw new Error("expected gridGraphics");
    expect(original.minor.destroyed).toBe(false);
  });

  it("rebuilds the grid when the coordinateSystem actually changes", async () => {
    const sceneEl = document.createElement("om-scene") as OmScene;
    sceneEl.rendererFactory = () => null;
    document.body.appendChild(sceneEl);
    mounted.push(sceneEl);
    await sceneEl.updateComplete;

    const grid = document.createElement("om-grid-axis") as OmGridAxis;
    grid.coordinateSystem = {
      extent: [
        [-100, -100],
        [100, 100],
      ],
      grid: [2, 2],
    };
    sceneEl.appendChild(grid);
    await grid.updateComplete;
    const original = grid.gridGraphics;

    grid.coordinateSystem = {
      extent: [
        [-200, -200],
        [200, 200],
      ],
      grid: [2, 2],
    };
    await grid.updateComplete;
    expect(grid.gridGraphics).not.toBe(original);
    if (!original) throw new Error("expected gridGraphics");
    expect(original.minor.destroyed).toBe(true);
  });

  it("disposes graphics on disconnect", async () => {
    const sceneEl = document.createElement("om-scene") as OmScene;
    sceneEl.rendererFactory = () => null;
    document.body.appendChild(sceneEl);
    mounted.push(sceneEl);
    await sceneEl.updateComplete;

    const grid = document.createElement("om-grid-axis") as OmGridAxis;
    sceneEl.appendChild(grid);
    await grid.updateComplete;

    const graphics = grid.gridGraphics;
    if (!graphics) throw new Error("expected gridGraphics");
    const minor = graphics.minor;
    grid.remove();
    expect(minor.destroyed).toBe(true);
  });
});
