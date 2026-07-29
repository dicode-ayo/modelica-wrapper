import { describe, expect, it } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import type { PickerFn } from "../src/interaction/interaction-manager.js";
import {
  componentNode,
  emptyLayout,
  mountLayout,
  sceneCanvas,
} from "./harness/interaction-fixtures.js";

/**
 * A host that re-reads the class after an edit has a layout to push back while
 * the user may already be dragging again. Swapping `layout` there drops the
 * draft and moves what is under the pointer, so the host swallows the push
 * instead — and `gestureActive` is what it tests to decide (issue #404).
 */

function oneComponent(): DiagramLayout {
  return {
    ...emptyLayout(),
    components: {
      r1: {
        name: "r1",
        classRef: "Test.Block",
        placement: {
          extent: [
            [-10, -10],
            [10, 10],
          ],
        },
      },
    },
  };
}

describe("<om-graphical-layout> gestureActive", () => {
  it("holds for the whole gesture, commit included", async () => {
    const r1 = componentNode("r1");
    const picker: PickerFn = () => r1;
    const el = await mountLayout({ picker, layout: oneComponent() });
    const canvas = sceneCanvas(el);

    const commits: string[] = [];
    el.addEventListener("om-graphical-layout-change", () =>
      commits.push("change"),
    );

    expect(el.gestureActive).toBe(false);

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 400,
        clientY: 200,
      }),
    );
    expect(el.gestureActive).toBe(true);

    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 440, clientY: 200 }),
    );
    // Drafted, nothing committed: a push landing here is the one that would
    // move the component out from under the cursor.
    expect(el.gestureActive).toBe(true);
    expect(commits).toEqual([]);

    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 440, clientY: 200 }),
    );

    expect(commits).toEqual(["change"]);
    expect(el.gestureActive).toBe(false);
  });

  it("stays false for a press that starts no gesture", async () => {
    const el = await mountLayout({
      picker: () => null,
      layout: oneComponent(),
    });
    const canvas = sceneCanvas(el);

    // Shift+primary is the pan modifier, so no gesture begins.
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, shiftKey: true }),
    );
    expect(el.gestureActive).toBe(false);
  });
});
