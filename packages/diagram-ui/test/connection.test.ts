import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core";

import "../src/scene/scene.component.js";
import "../src/connection/connection.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmConnection } from "../src/connection/connection.component.js";

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
