import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";

import { OmShapeNode } from "../src/base/shape-node.js";
import type { SceneContext } from "../src/scene/scene-context.js";

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

function makeNode(): {
  node: OmShapeNode;
  ctx: SceneContext;
  dispose: () => void;
} {
  const ctx = headlessCtx();
  const parent = new Container({ label: "parent" });
  ctx.diagramRoot.addChild(parent);
  const node = new OmShapeNode(ctx, parent, "om-shape:line:0");
  node.setPlacement(
    {
      extent: [
        [-10, -10],
        [10, 10],
      ],
    },
    undefined,
  );
  return {
    node,
    ctx,
    dispose: () => ctx.stage.destroy({ children: true }),
  };
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

/** Visible resize-corner / rotate handle containers under a node. */
function visibleHandles(node: OmShapeNode): { resize: number; rotate: number } {
  const vis = descendants(node.transform).filter((c) => c.visible);
  return {
    resize: vis.filter((c) => c.label.startsWith("om-handle:")).length,
    rotate: vis.filter((c) => c.label.startsWith("om-rotate-handle")).length,
  };
}

describe("OmShapeNode selection affordances", () => {
  it("shows resize + rotate handles by default when selected", () => {
    const { node, dispose } = makeNode();
    node.setSelected(true);
    expect(visibleHandles(node)).toEqual({ resize: 4, rotate: 1 });
    dispose();
  });

  it("suppresses resize + rotate handles when both affordances are off", () => {
    const { node, dispose } = makeNode();
    node.setSelectionAffordances({
      resize: false,
      rotate: false,
      vertices: true,
    });
    node.setSelected(true);
    expect(visibleHandles(node)).toEqual({ resize: 0, rotate: 0 });
    dispose();
  });

  it("hides already-shown handles when affordances are revoked live", () => {
    const { node, dispose } = makeNode();
    node.setSelected(true);
    expect(visibleHandles(node).resize).toBe(4);
    node.setSelectionAffordances({
      resize: false,
      rotate: false,
      vertices: true,
    });
    expect(visibleHandles(node)).toEqual({ resize: 0, rotate: 0 });
    dispose();
  });

  it("keeps the handles on the extent box when rotation shifts its centre", () => {
    const { node, dispose } = makeNode();
    const handleCentroid = (): { x: number; y: number } => {
      const hs = descendants(node.transform).filter((c) =>
        c.label.startsWith("om-handle:"),
      );
      const n = hs.length || 1;
      return {
        x: hs.reduce((s, c) => s + c.position.x, 0) / n,
        y: hs.reduce((s, c) => s + c.position.y, 0) / n,
      };
    };

    // Off-centre extent → handles centred on (150, 240).
    node.setDiagramBounds(
      [
        [50, 200],
        [250, 280],
      ],
      undefined,
      0,
    );
    node.setSelected(true);
    expect(handleCentroid().x).toBeCloseTo(150);
    expect(handleCentroid().y).toBeCloseTo(240);

    // Rotation rebases the origin: same-size extent re-centres on (0, 0).
    // The handles (local to the entity transform) must follow.
    node.setDiagramBounds(
      [
        [-100, -40],
        [100, 40],
      ],
      [150, 240],
      90,
    );
    expect(handleCentroid().x).toBeCloseTo(0);
    expect(handleCentroid().y).toBeCloseTo(0);
    dispose();
  });

  it("reveals the hit tube and vertex dots on hover, like a connection edge", () => {
    const { node, dispose } = makeNode();
    node.setPolyPoints([
      [-5, 0],
      [5, 0],
    ]);
    const dots = () =>
      descendants(node.transform).filter(
        (c) => c.visible && c.label.startsWith("om-vertex-handle"),
      ).length;
    const tube = descendants(node.transform).find((c) =>
      c.label.startsWith("hit.om-shape"),
    );

    // At rest: tube invisible (alpha 0, still pickable), no dots.
    expect(tube?.alpha).toBe(0);
    expect(dots()).toBe(0);

    node.setHovered(true);
    expect(tube?.alpha).toBeGreaterThan(0);
    expect(dots()).toBe(2);

    node.setHovered(false);
    expect(tube?.alpha).toBe(0);
    expect(dots()).toBe(0);
    dispose();
  });
});
