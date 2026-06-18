import { afterEach } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import type { DiagramLayout } from "@dicode/omc-client";

import "../../src/graphical-layout/graphical-layout.component.js";
import type { OmGraphicalLayout } from "../../src/graphical-layout/graphical-layout.component.js";
import type { OmScene } from "../../src/scene/scene.component.js";
import type { PickerFn } from "../../src/interaction/interaction-manager.js";

/**
 * Shared fixtures for driving `<om-graphical-layout>` interaction through
 * a mounted component with a deterministic picker. Resources registered
 * here are torn down after each test, so callers don't repeat cleanup.
 */

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

/** A throwaway `NullEngine` scene for building pickable fake nodes. */
export function nullScene(): Scene {
  const engine = new NullEngine({
    renderWidth: 100,
    renderHeight: 100,
    textureSize: 64,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  const scene = new Scene(engine);
  teardowns.push(() => {
    scene.dispose();
    engine.dispose();
  });
  return scene;
}

/** A connector with a pickable port indicator — resolves to `k:<id>`. */
export function portMesh(scene: Scene, connectorId: string): TransformNode {
  const conn = new TransformNode(`om-connector:${connectorId}`, scene);
  const port = new TransformNode("om-port-indicator", scene);
  port.parent = conn;
  port.metadata = { kind: "port" };
  return port;
}

/** A bare connector node — resolves to `k:<id>`. */
export function connectorMesh(
  scene: Scene,
  connectorId: string,
): TransformNode {
  return new TransformNode(`om-connector:${connectorId}`, scene);
}

export function emptyLayout(): DiagramLayout {
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

export async function mountLayout(opts: {
  picker: PickerFn;
  layout?: DiagramLayout;
}): Promise<OmGraphicalLayout> {
  const el = document.createElement("om-graphical-layout") as OmGraphicalLayout;
  el.engineFactory = () =>
    new NullEngine({
      renderWidth: 200,
      renderHeight: 200,
      textureSize: 128,
      deterministicLockstep: false,
      lockstepMaxSteps: 1,
    });
  el.pickerFactory = () => opts.picker;
  el.layout = opts.layout ?? emptyLayout();
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

/**
 * The scene canvas, with a pinned bounding box. jsdom doesn't lay out, so
 * the canvas measures 0×0 and `clientToDiagram` degenerates without it.
 */
export function sceneCanvas(el: OmGraphicalLayout): HTMLCanvasElement {
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
