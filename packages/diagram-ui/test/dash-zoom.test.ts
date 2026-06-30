/**
 * A dashed `<om-line>` / `<om-polygon>` stroke's on-screen rhythm should
 * stay a constant size across zoom (issue #165). These pin the rebuild
 * wiring end to end: zooming the host `<om-scene>` rebuilds a dashed
 * primitive's stroke (a new Graphics, since the dash period changed), but
 * leaves a solid primitive's stroke untouched (no needless churn).
 */
import { afterEach, describe, expect, it } from "vitest";
import { Container, Graphics } from "pixi.js";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";
import type { OmScene } from "../src/scene/scene.component.js";

function layoutWith(pattern: string | undefined): DiagramLayout {
  return {
    kind: "diagram",
    className: "T",
    source: { file: "T.mo", line: 1, column: 1 } as never,
    iconLayers: [],
    diagramLayers: [
      {
        from: "T",
        shapes: [
          {
            kind: "line",
            points: [
              [-500, 0],
              [500, 0],
            ],
            color: [255, 0, 0],
            ...(pattern !== undefined ? { pattern } : {}),
          },
        ],
      },
    ],
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

/** The host line's stroke Graphics — labeled `om-line.<zOrder>` (`0` here),
 *  a child of its `graphicItemNode` wrapper under the diagram root. */
function lineStroke(el: OmGraphicalLayout): Graphics {
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
  const g = found.find((c) => c.label === "om-line.0" && c instanceof Graphics);
  if (!(g instanceof Graphics)) throw new Error("expected the line stroke");
  return g;
}

describe("dashed stroke rebuild on zoom", () => {
  it("rebuilds a dashed line's stroke when the scene zooms", async () => {
    const el = await mount(layoutWith("Dash"));
    const scene = sceneOf(el);
    const before = lineStroke(el);
    expect(before.destroyed).toBe(false);

    scene.zoom = scene.zoom / 20;
    await scene.updateComplete;
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));

    const after = lineStroke(el);
    expect(after).not.toBe(before);
    expect(before.destroyed).toBe(true);
  });

  it("does not rebuild a solid line's stroke when the scene zooms", async () => {
    const el = await mount(layoutWith(undefined));
    const scene = sceneOf(el);
    const before = lineStroke(el);

    scene.zoom = scene.zoom / 20;
    await scene.updateComplete;
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));

    const after = lineStroke(el);
    expect(after).toBe(before);
    expect(before.destroyed).toBe(false);
  });
});
