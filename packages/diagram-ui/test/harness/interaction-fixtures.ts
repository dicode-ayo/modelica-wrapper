import { afterEach } from "vitest";
import { Container } from "pixi.js";
import type { DiagramLayout } from "@dicode/omc-client";

import "../../src/graphical-layout/graphical-layout.component.js";
import type { OmGraphicalLayout } from "../../src/graphical-layout/graphical-layout.component.js";
import type { OmScene } from "../../src/scene/scene.component.js";
import type { PickerFn } from "../../src/interaction/interaction-manager.js";
import { tagEntity } from "../../src/interaction/node-keys.js";

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

/** A bare entity container tagged with its identity — the renderer-less
 *  analog of a named Babylon node, picked by the test stubs. */
export function entityNode(
  kind: Parameters<typeof tagEntity>[1],
  nodeId: string,
): Container {
  const c = new Container();
  tagEntity(c, kind, nodeId);
  return c;
}

/** A component container — resolves to `c:<id>`. */
export function componentNode(id: string): Container {
  return entityNode("component", id);
}

/** A connector with a pickable port indicator — resolves to `k:<id>`. */
export function portMesh(connectorId: string): Container {
  const conn = entityNode("connector", connectorId);
  const port = new Container();
  tagEntity(port, "port", connectorId);
  conn.addChild(port);
  return port;
}

/** A bare connector container — resolves to `k:<id>`. */
export function connectorMesh(connectorId: string): Container {
  return entityNode("connector", connectorId);
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
  el.rendererFactory = () => null;
  el.pickerFactory = () => opts.picker;
  el.layout = opts.layout ?? emptyLayout();
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

/**
 * The scene canvas, with a pinned bounding box. happy-dom doesn't lay out,
 * so the canvas measures 0×0 and `clientToDiagram` degenerates without it.
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
