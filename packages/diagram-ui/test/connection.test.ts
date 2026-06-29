import { afterEach, describe, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { ContextProvider } from "@lit/context";

import "../src/scene/scene.component.js";
import "../src/connection/connection.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmConnection } from "../src/connection/connection.component.js";
import {
  InteractionStateStore,
  interactionStateContext,
} from "../src/interaction/interaction-state.js";

/**
 * Lit host that publishes an `InteractionStateStore` via context so a
 * descendant `<om-connection>` can self-subscribe to hover updates,
 * the same way `<om-graphical-layout>` does in production. Exposed
 * here so the test can drive the store directly without spinning up
 * the full graphical-layout pipeline.
 */
@customElement("om-interaction-host")
class OmInteractionHost extends LitElement {
  readonly store = new InteractionStateStore();
  private readonly provider = new ContextProvider(this, {
    context: interactionStateContext,
    initialValue: this.store,
  });
  override render() {
    // Touch the provider to keep tsc happy about the side-effect-only
    // construction; the host is otherwise a transparent wrapper.
    void this.provider;
    return html`<slot></slot>`;
  }
}

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

async function mountScene(): Promise<OmScene> {
  const scene = document.createElement("om-scene") as OmScene;
  // Renderer-less: build the Pixi scene graph on the CPU, no GPU context.
  scene.rendererFactory = () => null;
  document.body.appendChild(scene);
  teardowns.push(() => scene.remove());
  await scene.updateComplete;
  return scene;
}

/**
 * Mount an `<om-scene>` wrapped in an `<om-interaction-host>` so the
 * connection's `interactionStateContext` subscription resolves. Returns
 * the scene + the shared store so the test can publish hover keys.
 */
async function mountSceneWithStore(): Promise<{
  scene: OmScene;
  store: InteractionStateStore;
}> {
  const host = document.createElement(
    "om-interaction-host",
  ) as OmInteractionHost;
  document.body.appendChild(host);
  teardowns.push(() => host.remove());
  const scene = document.createElement("om-scene") as OmScene;
  scene.rendererFactory = () => null;
  host.appendChild(scene);
  await scene.updateComplete;
  return { scene, store: host.store };
}

describe("<om-connection>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-connection")).toBeDefined();
  });

  it("draws a junction marker at each internal waypoint", async () => {
    const scene = await mountScene();
    const conn = document.createElement("om-connection") as OmConnection;
    conn.nodeId = "c1";
    conn.path = [
      [-10, 0],
      [0, 0],
      [0, 10],
      [10, 10],
    ];
    conn.showJunctions = true;
    scene.appendChild(conn);
    await conn.updateComplete;
    // 4 path points → 2 internal corners.
    expect(conn.junctions.length).toBe(2);
  });

  it("keeps junctions invisible at rest and reveals every disc when the connection is hovered", async () => {
    // Self-managing path: `<om-connection>` subscribes to
    // `interactionStateContext` and reacts to `hoverKey` directly,
    // lighting the whole route when the pointer is over its edge or any
    // of its junctions. The host (in production: `<om-graphical-layout>`)
    // only owns the store; the connection owns the key → hover mapping.
    const { scene, store } = await mountSceneWithStore();
    const conn = document.createElement("om-connection") as OmConnection;
    conn.nodeId = "c1";
    conn.path = [
      [-10, 0],
      [0, 0],
      [0, 10],
      [10, 10],
    ];
    conn.showJunctions = true;
    scene.appendChild(conn);
    await conn.updateComplete;
    expect(conn.isHovered).toBe(false);
    expect(conn.junctions.length).toBe(2);
    for (const disc of conn.junctions) {
      expect(disc.alpha).toBe(0);
    }

    // Hovering a single junction reveals ALL of the connection's discs.
    store.next({ hoverKey: "junc:c1/1" });
    await conn.updateComplete;
    expect(conn.isHovered).toBe(true);
    for (const disc of conn.junctions) {
      expect(disc.alpha).toBe(1);
    }

    // A key for a different connection must NOT trigger this one.
    store.next({ hoverKey: "junc:c2/1" });
    await conn.updateComplete;
    expect(conn.isHovered).toBe(false);
    for (const disc of conn.junctions) {
      expect(disc.alpha).toBe(0);
    }

    // Hovering the edge itself lights the whole route too.
    store.next({ hoverKey: "edge:c1" });
    await conn.updateComplete;
    expect(conn.isHovered).toBe(true);
    for (const disc of conn.junctions) {
      expect(disc.alpha).toBe(1);
    }

    store.next({ hoverKey: null });
    await conn.updateComplete;
    expect(conn.isHovered).toBe(false);
    for (const disc of conn.junctions) {
      expect(disc.alpha).toBe(0);
    }
  });

  it("stays highlighted while it is the active drag target even as the hover key clears", async () => {
    // During an edge / waypoint drag the geometry slides out from under
    // the cursor each frame, so the hover key flips to null. Gating on
    // the move state's keys keeps the route lit instead of flickering.
    const { scene, store } = await mountSceneWithStore();
    const conn = document.createElement("om-connection") as OmConnection;
    conn.nodeId = "c1";
    conn.path = [
      [-10, 0],
      [0, 0],
      [0, 10],
      [10, 10],
    ];
    conn.showJunctions = true;
    scene.appendChild(conn);
    await conn.updateComplete;

    // Edge drag in flight: hover key is null but the move targets us.
    store.next({
      hoverKey: null,
      state: { kind: "moving", keys: ["edge:c1"] },
    });
    await conn.updateComplete;
    expect(conn.isHovered).toBe(true);
    for (const disc of conn.junctions) {
      expect(disc.alpha).toBe(1);
    }

    // Dragging one of our junctions keeps it lit too.
    store.next({ state: { kind: "moving", keys: ["junc:c1/1"] } });
    await conn.updateComplete;
    expect(conn.isHovered).toBe(true);

    // A move targeting a different connection must NOT light us.
    store.next({ state: { kind: "moving", keys: ["edge:c2"] } });
    await conn.updateComplete;
    expect(conn.isHovered).toBe(false);

    // Drag ends with the pointer off the route → unhighlight.
    store.next({ state: { kind: "idle" }, hoverKey: null });
    await conn.updateComplete;
    expect(conn.isHovered).toBe(false);
    for (const disc of conn.junctions) {
      expect(disc.alpha).toBe(0);
    }
  });

  it("draws no markers when showJunctions=false", async () => {
    const scene = await mountScene();
    const conn = document.createElement("om-connection") as OmConnection;
    conn.path = [
      [0, 0],
      [5, 0],
      [5, 5],
    ];
    conn.showJunctions = false;
    scene.appendChild(conn);
    await conn.updateComplete;
    expect(conn.junctions.length).toBe(0);
  });

  it("does not rebuild junctions when a fresh path with identical content is assigned", async () => {
    // Same OMC-roundtrip scenario as the OmEdge test: the connection
    // sees a new `path` array reference but its contents are
    // unchanged, so junction discs must survive intact.
    const scene = await mountScene();
    const conn = document.createElement("om-connection") as OmConnection;
    conn.nodeId = "c1";
    conn.path = [
      [-10, 0],
      [0, 0],
      [0, 10],
      [10, 10],
    ];
    conn.showJunctions = true;
    scene.appendChild(conn);
    await conn.updateComplete;
    const original = conn.junctions.slice();
    expect(original.length).toBe(2);

    conn.path = [
      [-10, 0],
      [0, 0],
      [0, 10],
      [10, 10],
    ];
    await conn.updateComplete;
    expect(conn.junctions).toEqual(original);
    for (const m of original) {
      expect(m.destroyed).toBe(false);
    }
  });

  it("repositions junction discs in place when waypoints shift", async () => {
    // Simulates the per-pointermove waypoint shift during a component
    // drag. The disc instances must stay alive (no dispose/recreate),
    // only their position should change — otherwise the dots blink
    // visibly as the component moves.
    const scene = await mountScene();
    const conn = document.createElement("om-connection") as OmConnection;
    conn.nodeId = "c1";
    conn.path = [
      [-10, 0],
      [0, 0],
      [0, 10],
      [10, 10],
    ];
    conn.showJunctions = true;
    scene.appendChild(conn);
    await conn.updateComplete;
    const original = conn.junctions.slice();
    expect(original.length).toBe(2);
    const [disc0, disc1] = original;
    if (disc0 === undefined || disc1 === undefined) {
      throw new Error("expected two junction discs");
    }

    conn.path = [
      [-10, 0],
      [5, 5],
      [5, 15],
      [10, 10],
    ];
    await conn.updateComplete;
    expect(conn.junctions).toEqual(original);
    expect(disc0.destroyed).toBe(false);
    expect(disc0.position.x).toBeCloseTo(5);
    expect(disc0.position.y).toBeCloseTo(5);
    expect(disc1.position.x).toBeCloseTo(5);
    expect(disc1.position.y).toBeCloseTo(15);
  });

  it("rebuilds junctions when the internal-waypoint count changes", async () => {
    // Adding/removing a waypoint changes topology — can't reuse the
    // existing discs, so a full rebuild is expected.
    const scene = await mountScene();
    const conn = document.createElement("om-connection") as OmConnection;
    conn.path = [
      [-10, 0],
      [0, 0],
      [0, 10],
      [10, 10],
    ];
    conn.showJunctions = true;
    scene.appendChild(conn);
    await conn.updateComplete;
    const original = conn.junctions.slice();
    expect(original.length).toBe(2);

    conn.path = [
      [-10, 0],
      [0, 0],
      [0, 10],
      [10, 10],
      [20, 10],
    ];
    await conn.updateComplete;
    expect(conn.junctions.length).toBe(3);
    for (const m of original) {
      expect(m.destroyed).toBe(true);
    }
  });

  it("disposes junction meshes on disconnect", async () => {
    const scene = await mountScene();
    const conn = document.createElement("om-connection") as OmConnection;
    conn.path = [
      [0, 0],
      [5, 0],
      [5, 5],
    ];
    scene.appendChild(conn);
    await conn.updateComplete;
    const meshes = conn.junctions.slice();
    conn.remove();
    for (const m of meshes) {
      expect(m.destroyed).toBe(true);
    }
  });
});
