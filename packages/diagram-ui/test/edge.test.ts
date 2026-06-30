import { afterEach, describe, expect, it } from "vitest";
import { Container } from "pixi.js";

import "../src/scene/scene.component.js";
import "../src/connection/edge.component.js";
import type { OmScene } from "../src/scene/scene.component.js";
import type { OmEdge } from "../src/connection/edge.component.js";
import { buildEdge } from "../src/connection/edge-build.js";
import { dashCount } from "./pixi-dash.helper.js";

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

async function mountScene(): Promise<OmScene> {
  const scene = document.createElement("om-scene") as OmScene;
  // Renderer-less: the Pixi scene graph is built on the CPU, no GPU context.
  scene.rendererFactory = () => null;
  document.body.appendChild(scene);
  teardowns.push(() => scene.remove());
  await scene.updateComplete;
  return scene;
}

describe("buildEdge", () => {
  it("returns null when given fewer than 2 points", () => {
    expect(buildEdge(new Container(), "edge", { points: [] })).toBeNull();
    expect(buildEdge(new Container(), "edge", { points: [[0, 0]] })).toBeNull();
  });

  it("builds line + hit-band Graphics parented to the provided container", () => {
    const parent = new Container();
    const result = buildEdge(parent, "edge", {
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    });
    expect(result).not.toBeNull();
    if (result === null) throw new Error("expected an edge");
    expect(result.line.parent).toBe(parent);
    expect(result.hitArea.parent).toBe(parent);
    // Pickable but transparent: the hit band stays grabbable at zero
    // opacity (eventMode `static` + an explicit hitArea). `visible` stays
    // true so the picker doesn't skip it.
    expect(result.hitArea.eventMode).toBe("static");
    expect(result.hitArea.hitArea).not.toBeNull();
    expect(result.hitArea.visible).toBe(true);
    expect(result.hitArea.alpha).toBe(0);
  });

  it("scales a clocked dash rhythm by worldPerPixel so it reads a constant size on screen", () => {
    const longPath: Array<[number, number]> = [
      [0, 0],
      [1000, 0],
    ];
    const zoomedIn = buildEdge(new Container(), "in", {
      points: longPath,
      clocked: true,
      worldPerPixel: 0.1,
    });
    const zoomedOut = buildEdge(new Container(), "out", {
      points: longPath,
      clocked: true,
      worldPerPixel: 5,
    });
    if (zoomedIn === null || zoomedOut === null) {
      throw new Error("expected both clocked edges");
    }
    expect(dashCount(zoomedIn.line)).toBeGreaterThan(dashCount(zoomedOut.line));
  });

  it("falls back to length-normalized dashing without a worldPerPixel", () => {
    const result = buildEdge(new Container(), "clocked", {
      points: [
        [0, 0],
        [100, 0],
      ],
      clocked: true,
    });
    if (result === null) throw new Error("expected a clocked edge");
    // The legacy fallback still produces a dashed (segmented) line, not a
    // single continuous run.
    expect(dashCount(result.line)).toBeGreaterThan(1);
  });
});

describe("<om-edge>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-edge")).toBeDefined();
  });

  it("creates a mesh when path has >= 2 points", async () => {
    const scene = await mountScene();
    const edge = document.createElement("om-edge") as OmEdge;
    edge.nodeId = "e1";
    edge.path = [
      [0, 0],
      [50, 0],
      [50, 30],
    ];
    scene.appendChild(edge);
    await edge.updateComplete;
    expect(edge.edgeMesh).not.toBeNull();
  });

  it("reveals the hit tube while hovered and hides it otherwise", async () => {
    const scene = await mountScene();
    const edge = document.createElement("om-edge") as OmEdge;
    edge.path = [
      [0, 0],
      [50, 0],
    ];
    scene.appendChild(edge);
    await edge.updateComplete;
    expect(edge.edgeMesh?.hitArea.alpha).toBe(0);

    edge.hovered = true;
    await edge.updateComplete;
    expect(edge.edgeMesh?.hitArea.alpha).toBeGreaterThan(0);

    edge.hovered = false;
    await edge.updateComplete;
    expect(edge.edgeMesh?.hitArea.alpha).toBe(0);
  });

  it("does not rebuild the mesh when a fresh path with identical content is assigned", async () => {
    // Simulates an OMC layout roundtrip: the host pushes a new
    // DiagramLayout whose connection waypoints have identical numbers but
    // a fresh array identity. Lit fires updated() with `path` in
    // `changed`, but the geometry is unchanged — the same EdgeMeshes must
    // survive, not be disposed + recreated.
    const scene = await mountScene();
    const edge = document.createElement("om-edge") as OmEdge;
    edge.path = [
      [0, 0],
      [50, 0],
      [50, 30],
    ];
    scene.appendChild(edge);
    await edge.updateComplete;
    const original = edge.edgeMesh;
    expect(original).not.toBeNull();

    edge.path = [
      [0, 0],
      [50, 0],
      [50, 30],
    ];
    await edge.updateComplete;
    expect(edge.edgeMesh).toBe(original);
    expect(original?.line.destroyed).toBe(false);
  });

  it("redraws the line in place when only point positions change", async () => {
    // Per-pointermove path shifts during a component drag must NOT dispose
    // + recreate the line Graphics — that's the scene-graph churn we want
    // to avoid. The same Graphics is reused (identity preserved) and its
    // drawn geometry reflects the new endpoint.
    const scene = await mountScene();
    const edge = document.createElement("om-edge") as OmEdge;
    edge.path = [
      [0, 0],
      [50, 0],
    ];
    scene.appendChild(edge);
    await edge.updateComplete;
    const originalLine = edge.edgeMesh?.line;
    expect(originalLine).toBeDefined();

    edge.path = [
      [0, 0],
      [60, 0],
    ];
    await edge.updateComplete;
    expect(edge.edgeMesh?.line).toBe(originalLine);
    expect(originalLine?.destroyed).toBe(false);
    // The redraw happened on the same Graphics: its drawn extent now
    // reaches the new endpoint (x = 60) rather than the old one (50).
    // (`getLocalBounds` includes the half stroke width, hence ~60.5.)
    const maxX = originalLine?.getLocalBounds().maxX ?? 0;
    expect(maxX).toBeGreaterThan(59);
    expect(maxX).toBeLessThan(62);
  });

  it("redraws the line in place when a waypoint is added", async () => {
    // A `Graphics` redraw is `clear()` + re-path, so a topology change
    // (added / dropped waypoint) reuses the same object: the same line
    // survives and its drawn geometry reflects the new waypoint.
    const scene = await mountScene();
    const edge = document.createElement("om-edge") as OmEdge;
    edge.path = [
      [0, 0],
      [50, 0],
    ];
    scene.appendChild(edge);
    await edge.updateComplete;
    const originalLine = edge.edgeMesh?.line;
    expect(originalLine).toBeDefined();

    edge.path = [
      [0, 0],
      [50, 0],
      [50, 30],
    ];
    await edge.updateComplete;
    expect(edge.edgeMesh?.line).toBe(originalLine);
    expect(originalLine?.destroyed).toBe(false);
    // The added corner at (50, 30) is now part of the drawn polyline.
    expect(originalLine?.getLocalBounds().maxY ?? 0).toBeGreaterThan(25);
  });

  it("disposes the mesh on disconnect", async () => {
    const scene = await mountScene();
    const edge = document.createElement("om-edge") as OmEdge;
    edge.path = [
      [0, 0],
      [10, 0],
    ];
    scene.appendChild(edge);
    await edge.updateComplete;
    const meshes = edge.edgeMesh;
    edge.remove();
    expect(meshes?.line.destroyed).toBe(true);
    expect(meshes?.hitArea.destroyed).toBe(true);
  });

  it("re-strokes a clocked edge's dash rhythm in place when the scene zooms", async () => {
    const scene = await mountScene();
    const edge = document.createElement("om-edge") as OmEdge;
    edge.clocked = true;
    edge.path = [
      [0, 0],
      [1000, 0],
    ];
    scene.appendChild(edge);
    await edge.updateComplete;
    const line = edge.edgeMesh?.line;
    if (!line) throw new Error("expected a clocked edge mesh");
    const dashesBefore = dashCount(line);

    scene.zoom = scene.zoom / 20; // zoom in a lot
    await scene.updateComplete;
    await edge.updateComplete;

    // Redrawn in place — same Graphics identity, no scene-graph churn.
    expect(edge.edgeMesh?.line).toBe(line);
    expect(line.destroyed).toBe(false);
    expect(dashCount(line)).toBeGreaterThan(dashesBefore);
  });

  it("does not redraw a non-clocked edge when the scene zooms", async () => {
    const scene = await mountScene();
    const edge = document.createElement("om-edge") as OmEdge;
    edge.path = [
      [0, 0],
      [1000, 0],
    ];
    scene.appendChild(edge);
    await edge.updateComplete;
    const line = edge.edgeMesh?.line;
    if (!line) throw new Error("expected an edge mesh");
    const before = (
      line.context.instructions as ReadonlyArray<unknown>
    ).slice();

    scene.zoom = scene.zoom / 20;
    await scene.updateComplete;
    await edge.updateComplete;

    expect(edge.edgeMesh?.line).toBe(line);
    expect((line.context.instructions as ReadonlyArray<unknown>).length).toBe(
      before.length,
    );
  });
});
