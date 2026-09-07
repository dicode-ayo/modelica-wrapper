import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasTextMetrics, Container } from "pixi.js";
import type { TextShape } from "@dicode/omc-client";

import "../src/primitives/text.component.js";
import type { OmText } from "../src/primitives/text.component.js";
import { parentNodeContext } from "../src/base/parent-node-context.js";
import { sceneContext, type SceneContext } from "../src/scene/scene-context.js";
import { WORLD_ROOT_LABEL } from "../src/scene/ortho-camera.js";
import {
  FONT_FIT_FACTOR,
  TRIAL_FONT_SIZE,
} from "../src/primitives/text-sizing.js";
import { ContextProvider } from "@lit/context";

const teardowns: Array<() => void> = [];

/** 200 × 20 — wide and short, so a long string is width-constrained. */
const EXTENT: TextShape["extent"] = [
  [-100, -10],
  [100, 10],
];

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
 * Mounts an `<om-text>` at `fontSize` 0 and returns the font size the built
 * Pixi text carries.
 */
async function builtFontSize(textString: string): Promise<number> {
  const ctx = headlessCtx();
  const placement = new Container({ label: "placement" });
  ctx.diagramRoot.addChild(placement);

  const host = document.createElement("div");
  document.body.appendChild(host);
  new ContextProvider(host, { context: sceneContext, initialValue: ctx });
  new ContextProvider(host, {
    context: parentNodeContext,
    initialValue: placement,
  });

  const el = document.createElement("om-text") as OmText;
  el.shape = { kind: "text", extent: EXTENT, fontSize: 0, textString };
  host.appendChild(el);
  await el.updateComplete;

  teardowns.push(() => {
    host.remove();
    ctx.stage.destroy({ children: true });
  });

  const built = placement.children.find((c) =>
    String(c.label).startsWith("om-text"),
  );
  if (built === undefined) throw new Error("om-text built no Pixi object");
  const size: unknown = (built as { style?: { fontSize?: unknown } }).style
    ?.fontSize;
  if (typeof size !== "number") throw new Error("built text has no fontSize");
  return size;
}

/** Stubs glyph metrics so the measured branch runs regardless of whether
 *  the test environment can back a 2D canvas. */
function stubMetrics(width: number, height: number): void {
  vi.spyOn(CanvasTextMetrics, "measureText").mockReturnValue({
    width,
    height,
  } as ReturnType<typeof CanvasTextMetrics.measureText>);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const t of teardowns.splice(0)) {
    t();
  }
});

/**
 * Modelica `fontSize == 0` scales the text to fit its extent (§18.6.5.5).
 * `fitFontSize` is unit-tested on its own; these cover the wiring — that
 * `<om-text>` feeds it real glyph metrics and puts the result on the built
 * text, and that it degrades to the height heuristic when metrics are
 * unavailable.
 */
describe("<om-text> fit to extent", () => {
  it("fits a short string to the extent height", async () => {
    // 50 × 110 at trial 100 in a 200 × 20 box: height constrains.
    stubMetrics(50, 110);

    expect(await builtFontSize("v")).toBeCloseTo(
      TRIAL_FONT_SIZE * (20 / 110),
      5,
    );
  });

  it("shrinks a long string to the extent width instead of overflowing", async () => {
    // 2000 × 110 at trial 100: width constrains, and the result is well
    // under what fitting the height alone would have picked.
    stubMetrics(2000, 110);

    const fitted = await builtFontSize("someVeryLongComponentName");
    expect(fitted).toBeCloseTo(TRIAL_FONT_SIZE * (200 / 2000), 5);
    expect(fitted).toBeLessThan(TRIAL_FONT_SIZE * (20 / 110));
  });

  it("falls back to the height heuristic when glyph metrics are unavailable", async () => {
    vi.spyOn(CanvasTextMetrics, "measureText").mockImplementation(() => {
      throw new Error("no 2D context");
    });

    expect(await builtFontSize("v")).toBeCloseTo(20 * FONT_FIT_FACTOR, 5);
  });
});
