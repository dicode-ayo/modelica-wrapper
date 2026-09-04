import { afterEach, describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import type { TextShape } from "@dicode/omc-client";

import "../src/primitives/text.component.js";
import type { OmText } from "../src/primitives/text.component.js";
import { parentNodeContext } from "../src/base/parent-node-context.js";
import { sceneContext, type SceneContext } from "../src/scene/scene-context.js";
import { WORLD_ROOT_LABEL } from "../src/scene/ortho-camera.js";
import { ContextProvider } from "@lit/context";

const teardowns: Array<() => void> = [];

const SHAPE: TextShape = {
  kind: "text",
  extent: [
    [-40, -10],
    [40, 10],
  ],
  textString: "speedSensor",
  fontSize: 12,
  textColor: [0, 0, 0],
  horizontalAlignment: "Center",
};

function headlessCtx(): SceneContext {
  const stage = new Container({ label: "om-stage" });
  const worldRoot = new Container({ label: WORLD_ROOT_LABEL });
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

/**
 * Mounts an `<om-text>` under a placement Container carrying `scale`, and
 * returns the Pixi text object it built.
 */
function builtTextIn(placement: Container): Container {
  const built = placement.children.find((c) =>
    String(c.label).startsWith("om-text"),
  );
  if (built === undefined) throw new Error("om-text built no Pixi object");
  return built;
}

async function mountTextUnderScale(scale: { x: number; y: number }): Promise<{
  text: Container;
  placement: Container;
  el: OmText;
}> {
  const ctx = headlessCtx();
  const placement = new Container({ label: "placement" });
  placement.scale.set(scale.x, scale.y);
  ctx.diagramRoot.addChild(placement);

  const host = document.createElement("div");
  document.body.appendChild(host);
  new ContextProvider(host, { context: sceneContext, initialValue: ctx });
  new ContextProvider(host, {
    context: parentNodeContext,
    initialValue: placement,
  });

  const el = document.createElement("om-text") as OmText;
  el.shape = SHAPE;
  host.appendChild(el);
  await el.updateComplete;

  teardowns.push(() => {
    host.remove();
    ctx.stage.destroy({ children: true });
  });

  return { text: builtTextIn(placement), placement, el };
}

afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

/**
 * A Modelica placement extent running `x2 < x1` (or `y2 < y1`) mirrors, and
 * `placementTransform` encodes that as a negative `scale` on the entity
 * Container. Text inherits that scale from its ancestors, so without an
 * explicit counter-mirror the glyphs render backwards —
 * `Modelica.Blocks.Examples.PID_Controller`'s `speedSensor` (extent
 * `[[22, -50], [2, -30]]`) drew "speedSensor" and "rad/s" reversed.
 */
describe("<om-text> mirrored placement", () => {
  it("counter-flips Y so glyphs survive the diagram root's Y-flip", async () => {
    const { text } = await mountTextUnderScale({ x: 1, y: 1 });

    expect(text.scale.x).toBe(1);
    expect(text.scale.y).toBe(-1);
  });

  it("un-mirrors glyphs under a horizontally mirrored placement", async () => {
    const { text } = await mountTextUnderScale({ x: -1, y: 1 });

    // Negative local X against the placement's negative X leaves the text
    // reading forwards; its position still mirrors with the component.
    expect(text.scale.x).toBe(-1);
    expect(text.scale.y).toBe(-1);
  });

  it("un-mirrors glyphs under a vertically mirrored placement", async () => {
    const { text } = await mountTextUnderScale({ x: 1, y: -1 });

    expect(text.scale.x).toBe(1);
    expect(text.scale.y).toBe(1);
  });

  it("leaves a doubly-mirrored placement reading forwards", async () => {
    const { text } = await mountTextUnderScale({ x: -1, y: -1 });

    expect(text.scale.x).toBe(-1);
    expect(text.scale.y).toBe(1);
  });

  it("rebuilds when the placement flips, which the magnitude-only scale term misses", async () => {
    const { placement, el } = await mountTextUnderScale({ x: 1, y: 1 });

    // `worldScaleOf` in the rebuild key takes |scale|, so a pure mirror leaves
    // that term identical. Only the fingerprint's mirror signs force the
    // rebuild that re-derives the counter-mirror.
    placement.scale.set(-1, 1);
    el.requestUpdate();
    await el.updateComplete;

    expect(builtTextIn(placement).scale.x).toBe(-1);
  });
});
