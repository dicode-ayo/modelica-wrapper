import { afterEach, describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { PickerFn } from "../src/interaction/interaction-manager.js";
import type { LayoutEvents } from "../src/graphical-layout/layout-events.js";

/**
 * Characterization of the connection-commit gate in `onDrag`: an
 * `om-connection-create` fires only when the drag lands on a snap target
 * that the local compatibility check didn't reject. Locks the behavior
 * before connection-create is lifted into its own mode.
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

function makePort(scene: Scene, connectorId: string): TransformNode {
  const conn = new TransformNode(`om-connector:${connectorId}`, scene);
  const port = new TransformNode("om-port-indicator", scene);
  port.parent = conn;
  port.metadata = { kind: "port" };
  return port;
}

function makeConnector(scene: Scene, connectorId: string): TransformNode {
  return new TransformNode(`om-connector:${connectorId}`, scene);
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

async function mount(
  layout: DiagramLayout,
  picker: PickerFn,
): Promise<OmGraphicalLayout> {
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
  el.layout = layout;
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
  // jsdom doesn't lay out, so the canvas measures 0×0 and clientToDiagram
  // degenerates. Pin a deterministic box like the unit-level drag tests.
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
    const { scene, dispose } = fakeNodeScene();
    teardowns.push(dispose);
    const source = makePort(scene, "out");
    const target = makeConnector(scene, "in");
    const picker: PickerFn = (cx) =>
      cx < 50 ? source : cx < 150 ? target : null;

    const el = await mount(emptyLayout(), picker);
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
    const { scene, dispose } = fakeNodeScene();
    teardowns.push(dispose);
    const source = makePort(scene, "out");
    const picker: PickerFn = (cx) => (cx < 50 ? source : null);

    const el = await mount(emptyLayout(), picker);
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
