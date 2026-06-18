import { describe, expect, it } from "vitest";

import type { PickerFn } from "../src/interaction/interaction-manager.js";
import type { LayoutEvents } from "../src/graphical-layout/layout-events.js";
import {
  connectorMesh,
  mountLayout,
  nullScene,
  portMesh,
  sceneCanvas,
} from "./harness/interaction-fixtures.js";

/**
 * Characterization of the connection-commit gate in `onDrag`: an
 * `om-connection-create` fires only when the drag lands on a snap target
 * that the local compatibility check didn't reject. Locks the behavior
 * before connection-create is lifted into its own mode.
 */

function drag(canvas: HTMLCanvasElement, fromX: number, toX: number): void {
  canvas.dispatchEvent(
    new PointerEvent("pointerdown", { button: 0, clientX: fromX, clientY: 20 }),
  );
  canvas.dispatchEvent(
    new PointerEvent("pointermove", { clientX: toX, clientY: 20 }),
  );
  canvas.dispatchEvent(
    new PointerEvent("pointerup", { button: 0, clientX: toX, clientY: 20 }),
  );
}

describe("<om-graphical-layout> connection commit gate", () => {
  it("emits om-connection-create when the drag lands on a snap target", async () => {
    const scene = nullScene();
    const source = portMesh(scene, "out");
    const target = connectorMesh(scene, "in");
    const picker: PickerFn = (cx) =>
      cx < 50 ? source : cx < 150 ? target : null;

    const el = await mountLayout({ picker });
    const created: LayoutEvents["om-connection-create"][] = [];
    el.addEventListener("om-connection-create", (e) => {
      created.push(
        (e as CustomEvent<LayoutEvents["om-connection-create"]>).detail,
      );
    });

    drag(sceneCanvas(el), 10, 100);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ fromKey: "k:out", toKey: "k:in" });
  });

  it("does not emit when the drag ends in empty space", async () => {
    const scene = nullScene();
    const source = portMesh(scene, "out");
    const picker: PickerFn = (cx) => (cx < 50 ? source : null);

    const el = await mountLayout({ picker });
    const created: LayoutEvents["om-connection-create"][] = [];
    el.addEventListener("om-connection-create", (e) => {
      created.push(
        (e as CustomEvent<LayoutEvents["om-connection-create"]>).detail,
      );
    });

    drag(sceneCanvas(el), 10, 300);

    expect(created).toHaveLength(0);
  });
});
