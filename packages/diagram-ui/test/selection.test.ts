import { afterEach, describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import type { Placement } from "@dicode/omc-client";

import { OmShapeNode } from "../src/base/shape-node.js";
import type { SceneContext } from "../src/scene/scene-context.js";

const teardowns: Array<() => void> = [];

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

/** Flatten a container subtree into a list. */
function descendants(root: Container): Container[] {
  const out: Container[] = [];
  const walk = (c: Container): void => {
    for (const child of c.children) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

function handlesUnder(root: Container): Container[] {
  return descendants(root).filter((c) => c.label.startsWith("om-handle:"));
}

afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

describe("OmShapeNode selection", () => {
  it("creates 4 resize-handle containers on first setSelected(true)", () => {
    const { ctx, parent } = makeScene();
    const node = new OmShapeNode(ctx, parent);
    node.setPlacement(
      {
        extent: [
          [-10, -10],
          [10, 10],
        ],
      } as Placement,
      undefined,
    );
    node.setSelected(true);
    expect(handlesUnder(node.transform)).toHaveLength(4);
    for (const corner of ["tl", "tr", "br", "bl"]) {
      expect(
        node.transform.getChildByLabel(`om-handle:${corner}`, true),
      ).toBeTruthy();
    }
  });

  it("toggles handle visibility on setSelected", () => {
    const { ctx, parent } = makeScene();
    const node = new OmShapeNode(ctx, parent);
    node.setPlacement(
      {
        extent: [
          [0, 0],
          [10, 10],
        ],
      } as Placement,
      undefined,
    );
    node.setSelected(true);
    const tl = node.transform.getChildByLabel("om-handle:tl", true);
    if (!tl) throw new Error("expected the tl handle");
    expect(tl.visible).toBe(true);
    node.setSelected(false);
    expect(tl.visible).toBe(false);
  });

  it("setHighlight is a no-op when the scene is renderer-less", async () => {
    const { ctx, parent } = makeScene();
    const node = new OmShapeNode(ctx, parent);
    node.setPlacement(
      {
        extent: [
          [-5, -5],
          [5, 5],
        ],
      } as Placement,
      undefined,
    );
    const { setHighlight } = await import("../src/base/selection-overlay.js");
    // Should not throw and should not attach a highlight outline (a
    // renderer-less scene has no GPU pass to draw it into).
    expect(() => setHighlight(ctx, node.mesh, 0x6199fa)).not.toThrow();
    expect(
      descendants(node.transform).some((c) => c.label === "om-highlight"),
    ).toBe(false);
  });

  it("disposes handles on shape-node dispose", () => {
    const { ctx, parent } = makeScene();
    const node = new OmShapeNode(ctx, parent);
    node.setPlacement(
      {
        extent: [
          [-5, -5],
          [5, 5],
        ],
      } as Placement,
      undefined,
    );
    node.setSelected(true);
    const tl = node.transform.getChildByLabel("om-handle:tl", true);
    if (!tl) throw new Error("expected the tl handle");
    node.dispose();
    expect(tl.destroyed).toBe(true);
  });
});
