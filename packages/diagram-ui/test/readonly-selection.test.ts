import { describe, expect, it } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import type { PickerFn } from "../src/interaction/interaction-manager.js";
import {
  componentNode,
  mountLayout,
  sceneCanvas,
} from "./harness/interaction-fixtures.js";
import { emptyLayout } from "./harness/layout-fixtures.js";

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

  it("still refuses to move anything on a read-only class", async () => {
    // The carve-out exempts `rubberBand` alone. Widening it to the gestures
    // that DO mutate is the mistake this guards against.
    const r1 = componentNode("r1");
    const el = await mountLayout({ picker: () => r1, layout: twoComponents() });
    el.readonly = true;
    await el.updateComplete;
    let committed = 0;
    el.addEventListener("om-graphical-layout-change", () => (committed += 1));
    const canvas = sceneCanvas(el);

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 10, clientY: 20 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 300, clientY: 200 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 300, clientY: 200 }),
    );

    expect(committed).toBe(0);
    expect(el.layout?.components.r1?.placement.extent).toEqual([
      [-40, -10],
      [-20, 10],
    ]);
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
