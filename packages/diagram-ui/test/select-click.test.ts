import { afterEach, describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { PickerFn } from "../src/interaction/interaction-manager.js";
import type { LayoutEvents } from "../src/graphical-layout/layout-events.js";

/**
 * Characterization of primary-click selection: a click on an entity
 * replaces the selection with that entity and emits
 * `om-selection-change`. Locks the select path that stays behind
 * `SelectMode` through the interaction refactor.
 */

function fakeNodeScene(): { scene: Scene; dispose: () => void } {
  const engine = new NullEngine({
    renderWidth: 100,
    renderHeight: 100,
    textureSize: 64,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  const scene = new Scene(engine);
  return {
    scene,
    dispose: () => {
      scene.dispose();
      engine.dispose();
    },
  };
}

function emptyLayout(): DiagramLayout {
  return {
    kind: "diagram",
    className: "Demo",
    source: { file: "demo.mo", line: 1, column: 1 } as never,
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {},
    components: {},
    connectors: {},
    connections: [],
  };
}

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

async function mount(picker: PickerFn): Promise<OmGraphicalLayout> {
  const el = document.createElement("om-graphical-layout") as OmGraphicalLayout;
  el.engineFactory = () =>
    new NullEngine({
      renderWidth: 200,
      renderHeight: 200,
      textureSize: 128,
      deterministicLockstep: false,
      lockstepMaxSteps: 1,
    });
  el.pickerFactory = () => picker;
  el.layout = emptyLayout();
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

function sceneCanvas(el: OmGraphicalLayout): HTMLCanvasElement {
  const scene = el.shadowRoot?.querySelector("om-scene") as OmScene | null;
  const canvas = scene?.canvasElement;
  if (!canvas) {
    throw new Error("scene canvas not mounted");
  }
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
  return canvas;
}

function click(canvas: HTMLCanvasElement, x: number): void {
  canvas.dispatchEvent(
    new PointerEvent("pointerdown", { button: 0, clientX: x, clientY: 20 }),
  );
  canvas.dispatchEvent(
    new PointerEvent("pointerup", { button: 0, clientX: x, clientY: 20 }),
  );
}

describe("<om-graphical-layout> click selection", () => {
  it("selects the clicked entity and replaces a prior selection", async () => {
    const { scene, dispose } = fakeNodeScene();
    teardowns.push(dispose);
    const r1 = new TransformNode("om-component:R1", scene);
    const c1 = new TransformNode("om-component:C1", scene);
    const picker: PickerFn = (cx) => (cx < 100 ? r1 : c1);

    const el = await mount(picker);
    const changes: LayoutEvents["om-selection-change"][] = [];
    el.addEventListener("om-selection-change", (e) => {
      changes.push(
        (e as CustomEvent<LayoutEvents["om-selection-change"]>).detail,
      );
    });
    const canvas = sceneCanvas(el);

    click(canvas, 10);
    expect(el.selection).toEqual(["c:R1"]);

    click(canvas, 190);
    expect(el.selection).toEqual(["c:C1"]);

    expect(changes.at(-1)).toEqual({ keys: ["c:C1"] });
  });
});
