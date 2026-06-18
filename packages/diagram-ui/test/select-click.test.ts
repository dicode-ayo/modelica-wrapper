import { describe, expect, it } from "vitest";
import { TransformNode } from "@babylonjs/core";

import type { PickerFn } from "../src/interaction/interaction-manager.js";
import type { LayoutEvents } from "../src/graphical-layout/layout-events.js";
import {
  mountLayout,
  nullScene,
  sceneCanvas,
} from "./harness/interaction-fixtures.js";

/**
 * Characterization of primary-click selection: a click on an entity
 * replaces the selection with that entity and emits
 * `om-selection-change`. Locks the select path that stays behind
 * `SelectMode` through the interaction refactor.
 */

function click(canvas: HTMLCanvasElement, x: number): void {
  canvas.dispatchEvent(
    new PointerEvent("pointerdown", { button: 0, clientX: x, clientY: 20 }),
  );
  canvas.dispatchEvent(
    new PointerEvent("pointerup", { button: 0, clientX: x, clientY: 20 }),
  );
}

describe("<om-graphical-layout> click selection", () => {
  it("selects the clicked entity and replaces a prior selection", async () => {
    const scene = nullScene();
    const r1 = new TransformNode("om-component:R1", scene);
    const c1 = new TransformNode("om-component:C1", scene);
    const picker: PickerFn = (cx) => (cx < 100 ? r1 : c1);

    const el = await mountLayout({ picker });
    const changes: LayoutEvents["om-selection-change"][] = [];
    el.addEventListener("om-selection-change", (e) => {
      changes.push(
        (e as CustomEvent<LayoutEvents["om-selection-change"]>).detail,
      );
    });
    const canvas = sceneCanvas(el);

    click(canvas, 10);
    expect(el.selection).toEqual(["c:R1"]);

    click(canvas, 190);
    expect(el.selection).toEqual(["c:C1"]);

    expect(changes.at(-1)).toEqual({ keys: ["c:C1"] });
  });
});
