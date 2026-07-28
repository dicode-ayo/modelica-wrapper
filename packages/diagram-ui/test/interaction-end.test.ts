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
 * A host that re-fetches after an edit has a layout to push back while the
 * user may already be dragging again. Swapping `layout` there moves what is
 * under the pointer, so the host holds the push until `om-interaction-end`
 * says the diagram is quiescent — and `gestureActive` is what it tests to
 * decide (issue #404).
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
  } as DiagramLayout;
}

describe("<om-graphical-layout> gesture boundaries", () => {
  it("reports a gesture as active for its whole duration and ends it with an event", async () => {
    const r1 = componentNode("r1");
    const picker: PickerFn = () => r1;
    const el = await mountLayout({ picker, layout: oneComponent() });
    const canvas = sceneCanvas(el);

    const seen: string[] = [];
    el.addEventListener("om-graphical-layout-change", () =>
      seen.push("change"),
    );
    el.addEventListener("om-interaction-end", () => seen.push("end"));

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
    expect(el.gestureActive).toBe(true);
    expect(seen).toEqual([]);

    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 440, clientY: 200 }),
    );

    expect(el.gestureActive).toBe(false);
    // The commit has to be posted before the host is told it may swap the
    // layout, or the edit would be attributed to the layout replacing it.
    expect(seen).toEqual(["change", "end"]);
  });
});
