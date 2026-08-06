import { afterEach, vi } from "vitest";
import { Container } from "pixi.js";
import type { DiagramLayout } from "@dicode/omc-client";

import "../../src/graphical-layout/graphical-layout.component.js";
import type { OmGraphicalLayout } from "../../src/graphical-layout/graphical-layout.component.js";
import type { OmScene } from "../../src/scene/scene.component.js";
import type { PickerFn } from "../../src/interaction/interaction-manager.js";
import type { SnapGrid } from "../../src/interaction/snap-math.js";
import { tagEntity } from "../../src/interaction/node-keys.js";
import { emptyLayout } from "./layout-fixtures.js";

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

export interface MountOptions {
  /** Deterministic hit-test. Omitted when the test drives no pointer path. */
  picker?: PickerFn;
  layout?: DiagramLayout;
  readonly?: boolean;
  /** `[0, 0]` isolates a path from grid snapping. */
  gridSnap?: SnapGrid;
}

/**
 * Mounts `<om-graphical-layout>` with a null renderer (no WebGL). The
 * factories are injected before connection so the inner scene's
 * `firstUpdated` sees them.
 */
export async function mountLayout(
  opts: MountOptions = {},
): Promise<OmGraphicalLayout> {
  const el = document.createElement("om-graphical-layout") as OmGraphicalLayout;
  el.rendererFactory = () => null;
  const picker = opts.picker;
  if (picker) {
    el.pickerFactory = () => picker;
  }
  if (opts.gridSnap) {
    el.gridSnap = opts.gridSnap;
  }
  el.readonly = opts.readonly ?? false;
  el.layout = opts.layout ?? emptyLayout();
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

/**
 * Replaces `<om-scene>`'s client→diagram projection with a fixed point and
 * pins the element's bounding box. happy-dom doesn't lay out, so without
 * both the scene measures 0×0 and every pointer lands on the same spot.
 */
export function stubSceneProjection(
  el: OmGraphicalLayout,
  point: { x: number; y: number },
  rect: { right: number; bottom: number } = { right: 200, bottom: 200 },
): { scene: HTMLElement; clientToDiagram: ReturnType<typeof vi.fn> } {
  const scene = el.shadowRoot?.querySelector("om-scene");
  if (!(scene instanceof HTMLElement)) {
    throw new Error("om-scene not rendered");
  }
  scene.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: rect.right, bottom: rect.bottom }) as DOMRect;
  const clientToDiagram = vi.fn(() => point);
  (scene as unknown as { clientToDiagram: unknown }).clientToDiagram =
    clientToDiagram;
  return { scene, clientToDiagram };
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
