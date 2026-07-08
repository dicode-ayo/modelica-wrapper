/**
 * Host-mediated placement on `<om-graphical-layout>`. A library row pressed in
 * the sidebar webview relays a `placementStart` to the diagram, which arms
 * placement here: a ghost tracks the cursor over the canvas and a release over
 * it emits `om-add-component-request` (the same path a drop uses). These pin the
 * state machine, not a live drag — the cross-iframe gesture can't be driven
 * headlessly.
 *
 * happy-dom pointer/mouse events don't carry client coords, so they're
 * synthesised from plain `Event`s with the coords defined on top.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import "./graphical-layout.component.js";
import type { OmGraphicalLayout } from "./graphical-layout.component.js";
import type { AddComponentRequestDetail } from "./layout-events.js";

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

/** A window mouse/pointer event carrying client coords happy-dom omits. */
function mouseEvent(type: string, x: number, y: number): MouseEvent {
  const event = new Event(type, { bubbles: true }) as MouseEvent;
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
  });
  return event;
}

/** The scene canvas spans client (0,0)–(200,200); (30,40) maps to diagram
 *  space. Points outside the rect are "off-canvas". */
async function mount(readonly = false): Promise<{
  el: OmGraphicalLayout;
  clientToDiagram: ReturnType<typeof vi.fn>;
}> {
  const el = document.createElement("om-graphical-layout") as OmGraphicalLayout;
  el.rendererFactory = () => null;
  el.gridSnap = [0, 0];
  el.readonly = readonly;
  el.layout = emptyLayout();
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;

  const scene = el.shadowRoot?.querySelector("om-scene");
  if (!(scene instanceof HTMLElement)) throw new Error("om-scene not rendered");
  scene.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 200, bottom: 200 }) as DOMRect;
  const clientToDiagram = vi.fn(() => ({ x: 30, y: 40 }));
  (scene as unknown as { clientToDiagram: unknown }).clientToDiagram =
    clientToDiagram;
  return { el, clientToDiagram };
}

describe("<om-graphical-layout> placement mode", () => {
  it("arms placement and reports the class name", async () => {
    const { el } = await mount();
    el.beginPlacement("Modelica.Blocks.Math.Gain");
    expect(el.placementClassName).toBe("Modelica.Blocks.Math.Gain");
  });

  // The ghost is asserted via the reactive ghost-point rather than the shadow
  // DOM: happy-dom scrambles Lit bindings when a new child binding lands next to
  // a custom element carrying `@event` attribute bindings, so the rendered node
  // isn't reliably queryable here. The render mapping (point → node) is trivial.
  it("tracks the cursor as a ghost anchor while over the canvas", async () => {
    const { el } = await mount();
    el.beginPlacement("Modelica.Blocks.Math.Gain");
    window.dispatchEvent(mouseEvent("pointermove", 100, 100));
    expect(el.placementGhostPoint).toEqual({ x: 100, y: 100 });
  });

  it("hides the ghost off the canvas but stays armed", async () => {
    const { el } = await mount();
    el.beginPlacement("A");
    window.dispatchEvent(mouseEvent("pointermove", 100, 100));
    expect(el.placementGhostPoint).toEqual({ x: 100, y: 100 });
    window.dispatchEvent(mouseEvent("pointermove", 500, 500));
    expect(el.placementGhostPoint).toBeNull();
    expect(el.placementClassName).toBe("A");
  });

  it("emits om-add-component-request once on release over the canvas and disarms", async () => {
    const { el, clientToDiagram } = await mount();
    const detail = vi.fn();
    el.addEventListener("om-add-component-request", (e) =>
      detail((e as CustomEvent<AddComponentRequestDetail>).detail),
    );
    el.beginPlacement("Modelica.Blocks.Math.Gain");
    window.dispatchEvent(mouseEvent("pointermove", 100, 100));
    window.dispatchEvent(mouseEvent("pointerup", 120, 130));

    expect(clientToDiagram).toHaveBeenLastCalledWith(120, 130);
    expect(detail).toHaveBeenCalledTimes(1);
    expect(detail).toHaveBeenCalledWith({
      className: "Modelica.Blocks.Math.Gain",
      position: { x: 30, y: 40 },
    });
    expect(el.placementClassName).toBeNull();
  });

  it("does not emit on release off the canvas and disarms", async () => {
    const { el } = await mount();
    const detail = vi.fn();
    el.addEventListener("om-add-component-request", detail);
    el.beginPlacement("A");
    window.dispatchEvent(mouseEvent("pointerup", 500, 500));

    expect(detail).not.toHaveBeenCalled();
    expect(el.placementClassName).toBeNull();
  });

  it("cancels on Escape", async () => {
    const { el } = await mount();
    el.beginPlacement("A");
    const escape = new Event("keydown", { bubbles: true }) as KeyboardEvent;
    Object.defineProperty(escape, "key", { value: "Escape" });
    window.dispatchEvent(escape);
    expect(el.placementClassName).toBeNull();
  });

  it("cancelPlacement clears the armed class", async () => {
    const { el } = await mount();
    el.beginPlacement("A");
    el.cancelPlacement();
    expect(el.placementClassName).toBeNull();
  });

  it("does not arm when readonly", async () => {
    const { el } = await mount(true);
    el.beginPlacement("A");
    expect(el.placementClassName).toBeNull();
  });

  it("stops emitting after a commit — a second release does nothing", async () => {
    const { el } = await mount();
    const detail = vi.fn();
    el.addEventListener("om-add-component-request", detail);
    el.beginPlacement("A");
    window.dispatchEvent(mouseEvent("pointerup", 120, 130));
    window.dispatchEvent(mouseEvent("pointerup", 120, 130));
    expect(detail).toHaveBeenCalledTimes(1);
  });
});
