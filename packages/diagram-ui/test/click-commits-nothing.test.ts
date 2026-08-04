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
 * A press inside the drag slop is a click, and a click must leave the layout
 * exactly as it found it. The delta reaching zero is not enough on its own:
 * the commit path also snaps the moved entity onto the grid, which edits an
 * off-grid one whether or not the pointer travelled (issue #404).
 */

function offGridComponent(): DiagramLayout {
  return {
    ...emptyLayout(),
    components: {
      r1: {
        name: "r1",
        classRef: "Test.Block",
        placement: {
          extent: [
            [3, 7],
            [23, 27],
          ],
        },
      },
    },
  } as DiagramLayout;
}

describe("<om-graphical-layout> a click on an off-grid component", () => {
  it("commits nothing, rather than snapping it onto the grid", async () => {
    const r1 = componentNode("r1");
    const picker: PickerFn = () => r1;
    const el = await mountLayout({ picker, layout: offGridComponent() });
    const canvas = sceneCanvas(el);

    const changes: DiagramLayout[] = [];
    el.addEventListener("om-graphical-layout-change", (e) => {
      changes.push((e as CustomEvent<DiagramLayout>).detail);
    });

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 400,
        clientY: 200,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 402, clientY: 201 }),
    );

    expect(changes).toEqual([]);
  });
});
