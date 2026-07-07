import { afterEach, describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import type { Placement } from "@dicode/omc-client";

import { OmShapeNode } from "../src/base/shape-node.js";
import type { SceneContext } from "../src/scene/scene-context.js";

const teardowns: Array<() => void> = [];

/** Renderer-less scene context: a Pixi container tree with no GPU. */
function headlessCtx(): SceneContext {
  const stage = new Container({ label: "om-stage" });
  const worldRoot = new Container({ label: "om-world" });
  const diagramRoot = new Container({ label: "om-diagram" });
  worldRoot.addChild(diagramRoot);
  stage.addChild(worldRoot);
  return {
    renderer: null,
    stage,
    worldRoot,
    diagramRoot,
    pick: () => null,
    worldPerPixel: () => 1,
    requestRender: () => {},
  };
}

function makeScene(): { ctx: SceneContext; parent: Container } {
  const ctx = headlessCtx();
  const parent = new Container({ label: "test-parent" });
  ctx.diagramRoot.addChild(parent);
  teardowns.push(() => ctx.stage.destroy({ children: true }));
  return { ctx, parent };
}

afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

describe("OmShapeNode", () => {
  it("creates an entity Container parented under the provided node", () => {
    const { ctx, parent } = makeScene();
    const node = new OmShapeNode(ctx, parent);
    expect(node.transform.parent).toBe(parent);
    expect(node.mesh.parent).toBe(node.transform);
  });

  it("setPlacement aligns the entity Container to the placement center", () => {
    const { ctx, parent } = makeScene();
    const node = new OmShapeNode(ctx, parent);
    const placement: Placement = {
      extent: [
        [10, 20],
        [30, 40],
      ],
    };
    node.setPlacement(placement, undefined);
    expect(node.transform.position.x).toBe(20);
    expect(node.transform.position.y).toBe(30);
  });

  it("setPlacement scales by (placement / coord-system) to keep local space icon-native", () => {
    const { ctx, parent } = makeScene();
    const node = new OmShapeNode(ctx, parent);
    const placement: Placement = {
      extent: [
        [-10, -10],
        [10, 10],
      ],
    };
    node.setPlacement(placement, {
      extent: [
        [-100, -100],
        [100, 100],
      ],
    });
    expect(node.transform.scale.x).toBeCloseTo(20 / 200);
    expect(node.transform.scale.y).toBeCloseTo(20 / 200);
  });

  it("dispose cleans up the entity Container and hit plane", () => {
    const { ctx, parent } = makeScene();
    const node = new OmShapeNode(ctx, parent);
    const mesh = node.mesh;
    node.dispose();
    expect(mesh.destroyed).toBe(true);
    expect(node.transform.destroyed).toBe(true);
  });
});
