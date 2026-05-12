import { describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode, Mesh } from "@babylonjs/core";

import {
  entityKeyForNode,
  formatKey,
  parseKey,
} from "../src/interaction/node-keys.js";

function makeScene(): { scene: Scene; dispose: () => void } {
  const engine = new NullEngine({
    renderWidth: 100,
    renderHeight: 100,
    textureSize: 64,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  const scene = new Scene(engine);
  return { scene, dispose: () => { scene.dispose(); engine.dispose(); } };
}

describe("formatKey / parseKey", () => {
  it("round-trips for each kind", () => {
    for (const [kind, id] of [
      ["component", "R1"],
      ["connector", "p"],
      ["edge", "e0"],
      ["junction", "j0"],
      ["label", "lbl0"],
      ["port", "p"],
      ["handle", "tl"],
    ] as const) {
      const key = formatKey(kind, id);
      const parsed = parseKey(key);
      expect(parsed).toEqual({ kind, nodeId: id });
    }
  });

  it("returns null for unrecognised prefixes", () => {
    expect(parseKey("nope:foo")).toBeNull();
    expect(parseKey("noColon")).toBeNull();
  });
});

describe("entityKeyForNode", () => {
  it("recognises a TransformNode by 'om-<kind>:<id>' naming", () => {
    const { scene, dispose } = makeScene();
    const t = new TransformNode("om-component:R1", scene);
    expect(entityKeyForNode(t)).toEqual({ kind: "component", nodeId: "R1" });
    dispose();
  });

  it("recognises a Mesh through its metadata", () => {
    const { scene, dispose } = makeScene();
    const m = new Mesh("anything", scene);
    m.metadata = { kind: "edge", nodeId: "e1" };
    expect(entityKeyForNode(m)).toEqual({ kind: "edge", nodeId: "e1" });
    dispose();
  });

  it("walks parents up the chain", () => {
    const { scene, dispose } = makeScene();
    const parent = new TransformNode("om-component:R2", scene);
    const child = new TransformNode("om-port:dot", scene);
    child.parent = parent;
    const grandchild = new Mesh("dot-mesh", scene);
    grandchild.parent = child;
    // dot-mesh has no metadata; om-port: doesn't match the regex.
    // The chain reaches om-component:R2 → that's the answer.
    expect(entityKeyForNode(grandchild)).toEqual({
      kind: "component",
      nodeId: "R2",
    });
    dispose();
  });

  it("returns null when nothing in the chain is tagged", () => {
    const { scene, dispose } = makeScene();
    const t = new TransformNode("plain", scene);
    expect(entityKeyForNode(t)).toBeNull();
    dispose();
  });
});
