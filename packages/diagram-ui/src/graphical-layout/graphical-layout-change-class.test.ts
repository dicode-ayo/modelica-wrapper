/**
 * Regression for the "Change class" render leak: swapping a component's
 * `classRef` must remount its `<om-component>`, not reuse it. A reused
 * element keeps the previous class's icon children in the Pixi scene, so
 * old and new visuals overlay (issue #278). The component `repeat` folds
 * `classRef` into its key precisely so Lit tears the node down and
 * rebuilds it on a swap.
 *
 * The unit env has no WebGL (null renderer), so the Pixi scene graph
 * isn't asserted directly. Element identity is the observable proxy: a
 * fresh `<om-component>` instance is exactly what runs the old one's
 * `disconnectedCallback` → `shapeNode.dispose()`.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import "./graphical-layout.component.js";
import type { OmGraphicalLayout } from "./graphical-layout.component.js";

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) t();
});

function layoutWith(classRef: string): DiagramLayout {
  return {
    kind: "diagram",
    className: "Test",
    source: {
      filename: "Test.mo",
      lineStart: 1,
      columnStart: 1,
      lineEnd: 1,
      columnEnd: 1,
    },
    classes: {
      [classRef]: {
        name: classRef,
        restriction: "model",
        iconLayers: [],
        connectors: {},
        parameters: {},
      },
    },
    components: {
      c1: {
        name: "c1",
        classRef,
        placement: {
          extent: [
            [-10, -10],
            [10, 10],
          ],
        },
      },
    },
    connectors: {},
    connections: [],
    labels: [],
    iconLayers: [],
    diagramLayers: [],
  };
}

async function mount(): Promise<OmGraphicalLayout> {
  const el = document.createElement("om-graphical-layout") as OmGraphicalLayout;
  el.rendererFactory = () => null;
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  return el;
}

function componentEl(el: OmGraphicalLayout): Element | null {
  return el.shadowRoot?.querySelector("om-component") ?? null;
}

describe("<om-graphical-layout> change-class render", () => {
  it("remounts the component node when its class changes", async () => {
    const el = await mount();
    el.layout = layoutWith("Modelica.Blocks.Continuous.Integrator");
    await el.updateComplete;
    const before = componentEl(el);
    expect(before).not.toBeNull();

    el.layout = layoutWith("Modelica.Blocks.Math.Gain");
    await el.updateComplete;
    const after = componentEl(el);

    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it("keeps the same node when only placement changes", async () => {
    const el = await mount();
    el.layout = layoutWith("Modelica.Blocks.Math.Gain");
    await el.updateComplete;
    const before = componentEl(el);

    const moved = layoutWith("Modelica.Blocks.Math.Gain");
    const c1 = moved.components.c1;
    if (c1) {
      c1.placement = {
        extent: [
          [0, 0],
          [20, 20],
        ],
      };
    }
    el.layout = moved;
    await el.updateComplete;

    expect(componentEl(el)).toBe(before);
  });
});
