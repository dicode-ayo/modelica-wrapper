/**
 * Drop-to-instantiate wiring on `<om-graphical-layout>`. A row dragged out of
 * `<om-library-tree>` carries `{ className }` under `LIBRARY_TREE_DRAG_FORMAT`;
 * dropping it on the canvas must convert the drop point to diagram space and
 * emit `om-add-component-request`. These pin the guards, not the happy path:
 * a foreign drag, a readonly canvas, a malformed payload, and an unmappable
 * drop point must each emit nothing.
 *
 * happy-dom's `DragEvent` doesn't carry a `DataTransfer` or client coords, so
 * events are synthesised from a plain stub.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import "./graphical-layout.component.js";
import type { OmGraphicalLayout } from "./graphical-layout.component.js";
import type { AddComponentRequestDetail } from "./layout-events.js";
import {
  LIBRARY_TREE_DRAG_FORMAT,
  serializeLibraryDrag,
} from "../library-tree/library-drag.js";

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) t();
});

function emptyLayout(): DiagramLayout {
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
    classes: {},
    components: {},
    connectors: {},
    connections: [],
    labels: [],
    iconLayers: [],
    diagramLayers: [],
  };
}

/** Minimal `DataTransfer` — happy-dom's constructor doesn't ride a synthetic
 *  `DragEvent`, so drops carry this stub instead. */
function makeDataTransfer(entries: Record<string, string>): DataTransfer {
  const store = new Map(Object.entries(entries));
  let dropEffect = "none";
  return {
    get types() {
      return [...store.keys()];
    },
    getData: (type: string) => store.get(type) ?? "",
    setData: (type: string, value: string) => void store.set(type, value),
    get dropEffect() {
      return dropEffect;
    },
    set dropEffect(value: string) {
      dropEffect = value;
    },
  } as unknown as DataTransfer;
}

function makeDragEvent(
  type: "dragover" | "drop",
  init: {
    dataTransfer: DataTransfer | null;
    clientX?: number;
    clientY?: number;
  },
): DragEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
  }) as DragEvent;
  Object.defineProperties(event, {
    dataTransfer: { value: init.dataTransfer },
    clientX: { value: init.clientX ?? 0 },
    clientY: { value: init.clientY ?? 0 },
  });
  return event;
}

async function mount(readonly = false): Promise<{
  el: OmGraphicalLayout;
  scene: HTMLElement;
  clientToDiagram: ReturnType<typeof vi.fn>;
}> {
  const el = document.createElement("om-graphical-layout") as OmGraphicalLayout;
  // Null renderer → no WebGL; disable snapping so the emitted position is the
  // raw `clientToDiagram` output, isolating the drop wiring from grid snap.
  el.rendererFactory = () => null;
  el.gridSnap = [0, 0];
  el.readonly = readonly;
  el.layout = emptyLayout();
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;

  const scene = el.shadowRoot?.querySelector("om-scene");
  if (!(scene instanceof HTMLElement)) throw new Error("om-scene not rendered");
  const clientToDiagram = vi.fn(() => ({ x: 30, y: 40 }));
  (scene as unknown as { clientToDiagram: unknown }).clientToDiagram =
    clientToDiagram;
  return { el, scene, clientToDiagram };
}

function libraryDataTransfer(className: string): DataTransfer {
  return makeDataTransfer({
    [LIBRARY_TREE_DRAG_FORMAT]: serializeLibraryDrag(className),
  });
}

describe("<om-graphical-layout> drag-to-instantiate", () => {
  it("emits om-add-component-request with the parsed class and converted position on drop", async () => {
    const { el, scene, clientToDiagram } = await mount();
    const detail = vi.fn();
    el.addEventListener("om-add-component-request", (e) =>
      detail((e as CustomEvent<AddComponentRequestDetail>).detail),
    );

    scene.dispatchEvent(
      makeDragEvent("drop", {
        dataTransfer: libraryDataTransfer("Modelica.Blocks.Math.Gain"),
        clientX: 120,
        clientY: 200,
      }),
    );

    expect(clientToDiagram).toHaveBeenCalledWith(120, 200);
    expect(detail).toHaveBeenCalledTimes(1);
    expect(detail).toHaveBeenCalledWith({
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 30, y: 40 },
    });
  });

  it("marks the canvas a copy drop target on dragover of a library drag", async () => {
    const { scene } = await mount();
    const dt = libraryDataTransfer("Modelica.Blocks.Math.Gain");
    const event = makeDragEvent("dragover", { dataTransfer: dt });

    scene.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(dt.dropEffect).toBe("copy");
  });

  it("ignores a dragover that doesn't carry the library format", async () => {
    const { scene } = await mount();
    const dt = makeDataTransfer({ "text/plain": "hello" });
    const event = makeDragEvent("dragover", { dataTransfer: dt });

    scene.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(dt.dropEffect).toBe("none");
  });

  it("does not emit on a drop without the library format", async () => {
    const { el, scene } = await mount();
    const detail = vi.fn();
    el.addEventListener("om-add-component-request", detail);

    scene.dispatchEvent(
      makeDragEvent("drop", {
        dataTransfer: makeDataTransfer({ "text/plain": "hello" }),
        clientX: 10,
        clientY: 10,
      }),
    );

    expect(detail).not.toHaveBeenCalled();
  });

  it("does not emit when readonly", async () => {
    const { el, scene } = await mount(true);
    const detail = vi.fn();
    el.addEventListener("om-add-component-request", detail);

    scene.dispatchEvent(
      makeDragEvent("drop", {
        dataTransfer: libraryDataTransfer("Modelica.Blocks.Math.Gain"),
        clientX: 10,
        clientY: 10,
      }),
    );

    expect(detail).not.toHaveBeenCalled();
  });

  it("does not mark a readonly canvas a drop target on dragover", async () => {
    const { scene } = await mount(true);
    const dt = libraryDataTransfer("Modelica.Blocks.Math.Gain");
    const event = makeDragEvent("dragover", { dataTransfer: dt });

    scene.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(dt.dropEffect).toBe("none");
  });

  it("does not emit when the payload is malformed", async () => {
    const { el, scene } = await mount();
    const detail = vi.fn();
    el.addEventListener("om-add-component-request", detail);

    scene.dispatchEvent(
      makeDragEvent("drop", {
        dataTransfer: makeDataTransfer({
          [LIBRARY_TREE_DRAG_FORMAT]: "not json {",
        }),
        clientX: 10,
        clientY: 10,
      }),
    );

    expect(detail).not.toHaveBeenCalled();
  });

  it("is a no-op when clientToDiagram can't map the drop point", async () => {
    const { el, scene } = await mount();
    (scene as unknown as { clientToDiagram: unknown }).clientToDiagram = () =>
      null;
    const detail = vi.fn();
    el.addEventListener("om-add-component-request", detail);

    scene.dispatchEvent(
      makeDragEvent("drop", {
        dataTransfer: libraryDataTransfer("Modelica.Blocks.Math.Gain"),
        clientX: 10,
        clientY: 10,
      }),
    );

    expect(detail).not.toHaveBeenCalled();
  });
});
