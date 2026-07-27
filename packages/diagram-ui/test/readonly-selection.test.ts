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
 * A read-only class still has to be selectable: copying a sub-system out of a
 * system-library model is the reason the clipboard is shared across editors,
 * and it is unusable if the only way to pick more than one component is
 * clicking them one at a time.
 */

function twoComponents(): DiagramLayout {
  return {
    ...emptyLayout(),
    components: {
      r1: {
        name: "r1",
        classRef: "Test.Block",
        placement: {
          extent: [
            [-40, -10],
            [-20, 10],
          ],
        },
      },
      c1: {
        name: "c1",
        classRef: "Test.Block",
        placement: {
          extent: [
            [20, -10],
            [40, 10],
          ],
        },
      },
    },
  };
}

function rubberBand(canvas: HTMLCanvasElement): void {
  canvas.dispatchEvent(
    new PointerEvent("pointerdown", { button: 0, clientX: 0, clientY: 0 }),
  );
  canvas.dispatchEvent(
    new PointerEvent("pointermove", { clientX: 799, clientY: 399 }),
  );
  canvas.dispatchEvent(
    new PointerEvent("pointerup", { button: 0, clientX: 799, clientY: 399 }),
  );
}

describe("<om-graphical-layout> read-only selection", () => {
  // Empty canvas everywhere, so a press starts a rubber band rather than a drag.
  const emptyPicker: PickerFn = () => null;

  it("rubber-bands a multi-selection on a read-only class", async () => {
    const el = await mountLayout({
      picker: emptyPicker,
      layout: twoComponents(),
    });
    el.readonly = true;
    await el.updateComplete;

    rubberBand(sceneCanvas(el));

    expect([...el.selection].sort()).toEqual(["c:c1", "c:r1"]);
  });

  it("ctrl-clicks into a multi-selection on a read-only class", async () => {
    const r1 = componentNode("r1");
    const c1 = componentNode("c1");
    const el = await mountLayout({
      picker: (cx) => (cx < 400 ? r1 : c1),
      layout: twoComponents(),
    });
    el.readonly = true;
    await el.updateComplete;
    const canvas = sceneCanvas(el);

    const click = (x: number, ctrlKey: boolean): void => {
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          clientX: x,
          clientY: 20,
          ctrlKey,
        }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointerup", {
          button: 0,
          clientX: x,
          clientY: 20,
          ctrlKey,
        }),
      );
    };

    click(10, false);
    click(700, true);

    expect([...el.selection].sort()).toEqual(["c:c1", "c:r1"]);
  });
});
