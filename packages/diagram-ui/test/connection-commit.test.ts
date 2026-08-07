import { describe, expect, it } from "vitest";

import type { LayoutEvents } from "../src/graphical-layout/layout-events.js";
import type { PickerFn } from "../src/interaction/interaction-manager.js";
import {
  connectorMesh,
  mountLayout,
  portMesh,
  sceneCanvas,
} from "./harness/interaction-fixtures.js";

/**
 * The connection-commit gate in `onDrag`: an `om-connection-create` fires
 * only when the drag lands on a snap target that the local compatibility
 * check didn't reject.
 *
 * Renderer-less: the picker is injected, so the fake entities are plain
 * tagged `Container`s — the gesture layer resolves them through the same
 * `entityKeyForNode` parent-chain walk it uses against the live graph.
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
    const source = portMesh("out");
    const target = connectorMesh("in");
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
    const source = portMesh("out");
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
