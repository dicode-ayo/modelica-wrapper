import { afterEach, describe, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { ContextProvider } from "@lit/context";
import { NullEngine } from "@babylonjs/core";

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
  scene.engineFactory = () =>
    new NullEngine({
      renderWidth: 200,
      renderHeight: 200,
      textureSize: 128,
      deterministicLockstep: false,
      lockstepMaxSteps: 1,
    });
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
  scene.engineFactory = () =>
    new NullEngine({
      renderWidth: 200,
      renderHeight: 200,
      textureSize: 128,
      deterministicLockstep: false,
      lockstepMaxSteps: 1,
    });
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

  it("keeps junctions invisible at rest and reveals the hovered disc when the interaction store publishes its key", async () => {
    // Self-managing path: `<om-connection>` subscribes to
    // `interactionStateContext` and reacts to `hoverKey` directly,
    // matching by compound junction nodeId (`${connId}/${idx}`). The
    // host (in production: `<om-graphical-layout>`) only owns the
    // store; the connection owns the mapping from key → disc.
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
    expect(conn.hoveredJunction).toBeNull();
    expect(conn.junctions.length).toBe(2);
    for (const disc of conn.junctions) {
      expect(disc.visibility).toBe(0);
    }

    store.next({ hoverKey: "junc:c1/1" });
    expect(conn.hoveredJunction).toBe("c1/1");
    expect(conn.junctions[0]!.visibility).toBe(1);
    expect(conn.junctions[1]!.visibility).toBe(0);

    // Hover key for a different connection must NOT trigger this one.
    store.next({ hoverKey: "junc:c2/1" });
    expect(conn.hoveredJunction).toBeNull();
    for (const disc of conn.junctions) {
      expect(disc.visibility).toBe(0);
    }

    store.next({ hoverKey: "junc:c1/2" });
    expect(conn.hoveredJunction).toBe("c1/2");
    expect(conn.junctions[1]!.visibility).toBe(1);

    store.next({ hoverKey: null });
    for (const disc of conn.junctions) {
      expect(disc.visibility).toBe(0);
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
      expect(m.isDisposed()).toBe(false);
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

    conn.path = [
      [-10, 0],
      [5, 5],
      [5, 15],
      [10, 10],
    ];
    await conn.updateComplete;
    expect(conn.junctions).toEqual(original);
    expect(original[0]!.isDisposed()).toBe(false);
    expect(original[0]!.position.x).toBeCloseTo(5);
    expect(original[0]!.position.y).toBeCloseTo(5);
    expect(original[1]!.position.x).toBeCloseTo(5);
    expect(original[1]!.position.y).toBeCloseTo(15);
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
      expect(m.isDisposed()).toBe(true);
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
      expect(m.isDisposed()).toBe(true);
    }
  });
});
