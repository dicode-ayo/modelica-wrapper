import { afterEach, describe, expect, it } from "vitest";
import { Circle, Container, Rectangle } from "pixi.js";

import "../src/scene/scene.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { SceneContext } from "../src/scene/scene-context.js";
import { buildEdge } from "../src/connection/edge-build.js";
import { entityKeyForNode, tagEntity } from "../src/interaction/node-keys.js";

/**
 * Tests run under happy-dom with a renderer-less Pixi scene graph, so no
 * WebGL is required. We exercise mount → context exposure → unmount, plus
 * property → view-transform propagation.
 */

// happy-dom has no layout, so getBoundingClientRect is 0 and the scene
// falls back to FALLBACK_CANVAS_* (800x600).
const W = 800;
const H = 600;

let mounted: OmScene[] = [];

async function mountScene(): Promise<OmScene> {
  const el = document.createElement("om-scene") as OmScene;
  // Renderer-less: build the Pixi scene graph on the CPU, no GPU context.
  el.rendererFactory = () => null;
  document.body.appendChild(el);
  // Wait for firstUpdated → mount() to run.
  await el.updateComplete;
  mounted.push(el);
  return el;
}

afterEach(() => {
  for (const el of mounted) {
    el.remove();
  }
  mounted = [];
});

describe("<om-scene>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-scene")).toBeDefined();
  });

  it("exposes the renderer-less context with its container roots after mount", async () => {
    const el = await mountScene();
    const ctx = el.sceneContextValue;
    expect(ctx).not.toBeNull();
    expect(ctx?.renderer).toBeNull();
    expect(ctx?.stage.label).toBe("om-stage");
    expect(ctx?.worldRoot.label).toBe("om-world");
    expect(ctx?.diagramRoot.label).toBe("om-diagram");
    expect(ctx?.diagramRoot.parent).toBe(ctx?.worldRoot);
  });

  it("flips Y on worldRoot so diagram +y renders screen-up", async () => {
    const el = await mountScene();
    const world = el.sceneContextValue?.worldRoot;
    expect(world).toBeDefined();
    // Modelica +y-up under a native +y-down canvas means exactly one
    // negative-Y scale on the world transform; X stays positive so +x is
    // screen-right (mirror-free, matching mouse drag direction).
    if (!world) throw new Error("no worldRoot");
    expect(world.scale.x).toBeGreaterThan(0);
    expect(world.scale.y).toBeLessThan(0);
  });

  it("recomputes the world transform when zoom / pan change", async () => {
    const el = await mountScene();
    el.zoom = 50;
    el.panX = 25;
    el.panY = -10;
    await el.updateComplete;
    const world = el.sceneContextValue?.worldRoot;
    if (!world) throw new Error("no worldRoot");
    const ppu = H / (2 * 50); // = 6
    expect(world.scale.x).toBeCloseTo(ppu, 5);
    expect(world.scale.y).toBeCloseTo(-ppu, 5);
    expect(world.position.x).toBeCloseTo(W / 2 - 25 * ppu, 5);
    expect(world.position.y).toBeCloseTo(H / 2 + -10 * ppu, 5);
  });

  it("disposes the Pixi stage on disconnect", async () => {
    const el = await mountScene();
    const stage = el.sceneContextValue?.stage;
    el.remove();
    expect(el.sceneContextValue).toBeNull();
    expect(stage?.destroyed).toBe(true);
  });

  it("clientToDiagram maps the canvas centre to (panX, panY)", async () => {
    const el = await mountScene();
    el.zoom = 100;
    el.panX = 5;
    el.panY = -3;
    await el.updateComplete;
    const shadowRoot = el.shadowRoot;
    if (!shadowRoot) throw new Error("no shadowRoot");
    const canvas = shadowRoot.querySelector("canvas");
    if (!canvas) throw new Error("no canvas");
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
    const pt = el.clientToDiagram(400, 200);
    expect(pt).not.toBeNull();
    if (pt === null) throw new Error("pt is null");
    expect(pt.x).toBeCloseTo(5);
    expect(pt.y).toBeCloseTo(-3);
  });

  describe("pick with an edge terminating on a connector at each end", () => {
    // Default zoom 100 on the 800x600 fallback canvas → 3 px per diagram
    // unit, diagram origin at the canvas center.
    const PPU = H / (2 * 100);
    const canvasPt = (x: number, y: number) => ({
      x: W / 2 + PPU * x,
      y: H / 2 - PPU * y,
    });

    /**
     * Component R1 spanning x 10..30 with its port `p` at (30, 0), a
     * standalone connector `src` at (0, 0), and a connection routed
     * between the two centers — the edge's pick band therefore runs
     * across both connectors, the component body and empty space.
     *
     * `src` carries the `zIndex` an `OmConnector` gets from its `zOffset`
     * of -1.5; the nested port has none of its own, inheriting its owning
     * component's 0.
     */
    async function mountPickScene(): Promise<SceneContext> {
      const el = await mountScene();
      const ctx = el.sceneContextValue;
      if (!ctx) throw new Error("no scene context");
      const comp = new Container();
      tagEntity(comp, "component", "R1");
      comp.eventMode = "static";
      comp.hitArea = new Rectangle(10, -5, 20, 10);
      const conn = new Container();
      tagEntity(conn, "connector", "p");
      conn.eventMode = "static";
      conn.hitArea = new Circle(0, 0, 3);
      conn.position.set(30, 0);
      comp.addChild(conn);
      ctx.diagramRoot.addChild(comp);
      const standalone = new Container();
      tagEntity(standalone, "connector", "src");
      standalone.eventMode = "static";
      standalone.hitArea = new Circle(0, 0, 3);
      standalone.zIndex = 1.5;
      ctx.diagramRoot.addChild(standalone);
      const meshes = buildEdge(ctx.diagramRoot, "om-edge:0", {
        points: [
          [0, 0],
          [30, 0],
        ],
      });
      if (!meshes) throw new Error("expected edge meshes");
      tagEntity(meshes.line, "edge", "0");
      tagEntity(meshes.hitArea, "edge", "0");
      return ctx;
    }

    function kindAt(
      ctx: SceneContext,
      x: number,
      y: number,
    ): { kind: string; nodeId: string } | null {
      const pt = canvasPt(x, y);
      const hit = ctx.pick(pt.x, pt.y);
      const entity = hit ? entityKeyForNode(hit) : null;
      return entity ? { kind: entity.kind, nodeId: entity.nodeId } : null;
    }

    it("resolves the connector, not the edge band, over the port body", async () => {
      const ctx = await mountPickScene();
      expect(kindAt(ctx, 28, 0)).toEqual({ kind: "connector", nodeId: "R1.p" });
    });

    it("resolves the connector at the route's terminal point", async () => {
      const ctx = await mountPickScene();
      expect(kindAt(ctx, 30, 0)).toEqual({ kind: "connector", nodeId: "R1.p" });
    });

    it("keeps the edge pick where the band crosses the component body", async () => {
      const ctx = await mountPickScene();
      expect(kindAt(ctx, 15, 0)).toEqual({ kind: "edge", nodeId: "0" });
    });

    it("keeps the edge pick over empty space", async () => {
      const ctx = await mountPickScene();
      expect(kindAt(ctx, 5, 0)).toEqual({ kind: "edge", nodeId: "0" });
    });

    it("resolves the standalone connector the band overlaps at the far end", async () => {
      const ctx = await mountPickScene();
      expect(kindAt(ctx, 0, 0)).toEqual({ kind: "connector", nodeId: "src" });
      expect(kindAt(ctx, 2, 0)).toEqual({ kind: "connector", nodeId: "src" });
    });
  });

  it("emits om-view-change events when PanZoom updates the view", async () => {
    const el = await mountScene();
    const shadowRoot = el.shadowRoot;
    if (!shadowRoot) throw new Error("no shadowRoot");
    const canvas = shadowRoot.querySelector("canvas");
    if (!canvas) throw new Error("no canvas");
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
    const received: { zoom: number; panX: number; panY: number }[] = [];
    el.addEventListener("om-view-change", (e) => {
      received.push((e as CustomEvent).detail);
    });
    // Wheel with ctrlKey to trigger the zoom path (plain wheel is
    // pan after the touchpad-friendly rebinding). happy-dom drops
    // modifier keys from the constructor init, so we patch the event
    // after construction.
    const e = new WheelEvent("wheel", {
      deltaY: -100,
      clientX: 400,
      clientY: 200,
    });
    Object.defineProperty(e, "ctrlKey", { value: true });
    canvas.dispatchEvent(e);
    const last = received.at(-1);
    if (last === undefined) throw new Error("received is null");
    expect(last.zoom).toBeLessThan(100);
  });
});
