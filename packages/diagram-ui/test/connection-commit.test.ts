import { afterEach, describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { PickerFn } from "../src/interaction/interaction-manager.js";
import type { LayoutEvents } from "../src/graphical-layout/layout-events.js";
import { tagEntity } from "../src/interaction/node-keys.js";

/**
 * The connection-commit gate in `onDrag`: an `om-connection-create` fires
 * only when the drag lands on a snap target that the local compatibility
 * check didn't reject.
 *
 * Renderer-less: the picker is injected, so the fake entities are plain
 * tagged `Container`s — the gesture layer resolves them through the same
 * `entityKeyForNode` parent-chain walk it uses against the live graph.
 */

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

/** A connector with a pickable port-indicator child — resolves to `k:<id>`. */
function portMesh(connectorId: string): Container {
  const conn = new Container();
  tagEntity(conn, "connector", connectorId);
  const port = new Container();
  tagEntity(port, "port", connectorId);
  conn.addChild(port);
  return port;
}

/** A bare connector node — resolves to `k:<id>`. */
function connectorMesh(connectorId: string): Container {
  const conn = new Container();
  tagEntity(conn, "connector", connectorId);
  return conn;
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

async function mountLayout(opts: {
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

function drag(canvas: HTMLCanvasElement, fromX: number, toX: number): void {
  canvas.dispatchEvent(
    new PointerEvent("pointerdown", { button: 0, clientX: fromX, clientY: 20 }),
  );
  canvas.dispatchEvent(
    new PointerEvent("pointermove", { clientX: toX, clientY: 20 }),
  );
  canvas.dispatchEvent(
    new PointerEvent("pointerup", { button: 0, clientX: toX, clientY: 20 }),
  );
}

describe("<om-graphical-layout> connection commit gate", () => {
  it("emits om-connection-create when the drag lands on a snap target", async () => {
    const source = portMesh("out");
    const target = connectorMesh("in");
    const picker: PickerFn = (cx) =>
      cx < 50 ? source : cx < 150 ? target : null;

    const el = await mountLayout({ picker });
    const created: LayoutEvents["om-connection-create"][] = [];
    el.addEventListener("om-connection-create", (e) => {
      created.push(
        (e as CustomEvent<LayoutEvents["om-connection-create"]>).detail,
      );
    });

    drag(sceneCanvas(el), 10, 100);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ fromKey: "k:out", toKey: "k:in" });
  });

  it("does not emit when the drag ends in empty space", async () => {
    const source = portMesh("out");
    const picker: PickerFn = (cx) => (cx < 50 ? source : null);

    const el = await mountLayout({ picker });
    const created: LayoutEvents["om-connection-create"][] = [];
    el.addEventListener("om-connection-create", (e) => {
      created.push(
        (e as CustomEvent<LayoutEvents["om-connection-create"]>).detail,
      );
    });

    drag(sceneCanvas(el), 10, 300);

    expect(created).toHaveLength(0);
  });
});
