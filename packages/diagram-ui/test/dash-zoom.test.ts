/**
 * A shape primitive's stroke should hold its screen-space contracts across
 * zoom: a dashed stroke keeps a constant on-screen rhythm, and a stroke
 * clamped by the one-pixel width floor re-resolves as the floor moves.
 * These pin the rebuild wiring end to end: zooming the host `<om-scene>`
 * rebuilds a dashed stroke and a floored default-thickness stroke (a new
 * Graphics, since period / width changed), but leaves a thick solid stroke
 * untouched (no needless churn), and the same wiring covers every stroked
 * primitive kind via `OmShapePrimitive.dashPattern()` /
 * `.strokeThickness()` — not just `<om-line>`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Container, Graphics } from "pixi.js";
import type { DiagramLayout, Shape } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";
import type { OmScene } from "../src/scene/scene.component.js";

function layoutWithLine(
  pattern: string | undefined,
  thickness?: number,
): DiagramLayout {
  return layout({
    kind: "line",
    points: [
      [-500, 0],
      [500, 0],
    ],
    color: [255, 0, 0],
    ...(pattern !== undefined ? { pattern } : {}),
    ...(thickness !== undefined ? { thickness } : {}),
  });
}

function layoutWithRectangle(
  pattern: string | undefined,
  thickness?: number,
): DiagramLayout {
  return layout({
    kind: "rectangle",
    extent: [
      [-500, -50],
      [500, 50],
    ],
    lineColor: [255, 0, 0],
    fillPattern: "None",
    ...(pattern !== undefined ? { pattern } : {}),
    ...(thickness !== undefined ? { lineThickness: thickness } : {}),
  });
}

function layout(shape: Shape): DiagramLayout {
  return {
    kind: "diagram",
    className: "T",
    source: { file: "T.mo", line: 1, column: 1 } as never,
    iconLayers: [],
    diagramLayers: [{ from: "T", shapes: [shape] }],
    labels: [],
    classes: {},
    components: {},
    connectors: {},
    connections: [],
  };
}

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) t();
});

async function mount(layout: DiagramLayout): Promise<OmGraphicalLayout> {
  const el = document.createElement("om-graphical-layout") as OmGraphicalLayout;
  el.rendererFactory = () => null;
  el.layout = layout;
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

function sceneOf(el: OmGraphicalLayout): OmScene {
  const scene = el.shadowRoot?.querySelector("om-scene") as OmScene | null;
  if (!scene) throw new Error("expected a mounted om-scene");
  return scene;
}

/** The host shape's stroke Graphics by exact label, a descendant of the
 *  diagram root (nested under its `graphicItemNode` wrapper). */
function strokeWithLabel(el: OmGraphicalLayout, label: string): Graphics {
  const root = sceneOf(el).sceneContextValue?.diagramRoot;
  if (!root) throw new Error("expected a diagram root");
  const found: Container[] = [];
  const walk = (c: Container): void => {
    for (const child of c.children) {
      found.push(child);
      walk(child);
    }
  };
  walk(root);
  const g = found.find((c) => c.label === label && c instanceof Graphics);
  if (!(g instanceof Graphics)) throw new Error(`expected the ${label} stroke`);
  return g;
}

async function zoomBy(
  el: OmGraphicalLayout,
  scene: OmScene,
  factor: number,
): Promise<void> {
  scene.zoom = scene.zoom * factor;
  await scene.updateComplete;
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
}

describe.each([
  { kind: "line", build: layoutWithLine, label: "om-line.0" },
  {
    kind: "rectangle",
    build: layoutWithRectangle,
    label: "om-rectangle.0.stroke",
  },
])("dashed $kind stroke rebuild on zoom", ({ build, label }) => {
  it("rebuilds the dashed stroke when the scene zooms", async () => {
    const el = await mount(build("Dash"));
    const scene = sceneOf(el);
    const before = strokeWithLabel(el, label);
    expect(before.destroyed).toBe(false);

    await zoomBy(el, scene, 1 / 20);

    const after = strokeWithLabel(el, label);
    expect(after).not.toBe(before);
    expect(before.destroyed).toBe(true);
  });

  it("does not rebuild a solid stroke that clears the width floor when the scene zooms", async () => {
    // Thickness 5 diagram units is comfortably above one screen pixel at
    // both zoom levels, so the resolved width is zoom-independent.
    const el = await mount(build(undefined, 5));
    const scene = sceneOf(el);
    const before = strokeWithLabel(el, label);

    await zoomBy(el, scene, 1 / 20);

    const after = strokeWithLabel(el, label);
    expect(after).toBe(before);
    expect(before.destroyed).toBe(false);
  });

  it("re-resolves a floored default-thickness solid stroke when the scene zooms", async () => {
    // The spec-default 0.25 sits under the one-pixel floor at the mount
    // zoom, so the resolved width tracks worldPerPixel until the floor
    // disengages — a zoom must rebuild the stroke.
    const el = await mount(build(undefined));
    const scene = sceneOf(el);
    const before = strokeWithLabel(el, label);

    await zoomBy(el, scene, 1 / 20);

    const after = strokeWithLabel(el, label);
    expect(after).not.toBe(before);
    expect(before.destroyed).toBe(true);
  });

  it("does not rebuild a floored solid stroke on a pure pan", async () => {
    const el = await mount(build(undefined));
    const scene = sceneOf(el);
    const before = strokeWithLabel(el, label);

    scene.panX = scene.panX + 50;
    await scene.updateComplete;
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));

    const after = strokeWithLabel(el, label);
    expect(after).toBe(before);
    expect(before.destroyed).toBe(false);
  });

  it("does not rebuild a dashed stroke on a pure pan (no zoom change)", async () => {
    const el = await mount(build("Dash"));
    const scene = sceneOf(el);
    const before = strokeWithLabel(el, label);

    scene.panX = scene.panX + 50;
    await scene.updateComplete;
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));

    const after = strokeWithLabel(el, label);
    expect(after).toBe(before);
    expect(before.destroyed).toBe(false);
  });
});
