import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";

function tinyLayout(): DiagramLayout {
  return {
    kind: "diagram",
    className: "T",
    source: { file: "T.mo", line: 1, column: 1 } as never,
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {
      "Test.Block": {
        name: "Test.Block",
        restriction: "block",
        iconLayers: [{ from: "Test.Block", shapes: [] }],
        connectors: {},
        parameters: {},
      },
    },
    components: {
      b1: {
        name: "b1",
        classRef: "Test.Block",
        placement: {
          extent: [
            [-10, -5],
            [10, 5],
          ],
        },
      },
    },
    connectors: {},
    connections: [],
  };
}

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) {
    t();
  }
});

async function mount(layout: DiagramLayout): Promise<OmGraphicalLayout> {
  const el = document.createElement("om-graphical-layout") as OmGraphicalLayout;
  // Inject test factories BEFORE connection so the inner scene's
  // firstUpdated sees them.
  el.engineFactory = () =>
    new NullEngine({
      renderWidth: 200,
      renderHeight: 200,
      textureSize: 128,
      deterministicLockstep: false,
      lockstepMaxSteps: 1,
    });
  el.layout = layout;
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

describe("<om-graphical-layout>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("om-graphical-layout")).toBeDefined();
  });

  it("renders one <om-component> per layout component", async () => {
    const el = await mount(tinyLayout());
    // Dump for diagnostic; the assertion message embeds the HTML so a
    // future regression points straight at the offending render output.
    const inner = el.shadowRoot!.innerHTML;
    const comps = el.shadowRoot!.querySelectorAll("om-component");
    expect(
      comps.length,
      `expected 1 om-component in shadow HTML: ${inner}`,
    ).toBe(1);
  });

  it("tracks selection via setSelection / selection", async () => {
    const el = await mount(tinyLayout());
    el.setSelection(["c:b1"]);
    expect(el.selection).toEqual(["c:b1"]);
    el.setSelection([]);
    expect(el.selection).toEqual([]);
  });

  it("ignores invalid selection keys", async () => {
    const el = await mount(tinyLayout());
    el.setSelection(["bogus", "c:b1"]);
    expect(el.selection).toEqual(["c:b1"]);
  });

  it("rotateSelection rotates the selection by 90° and emits a change", async () => {
    const el = await mount(tinyLayout());
    el.setSelection(["c:b1"]);
    let changed: DiagramLayout | null = null;
    el.addEventListener("om-graphical-layout-change", (e) => {
      changed = (e as CustomEvent<DiagramLayout>).detail;
    });

    el.rotateSelection(true);

    expect(changed).not.toBeNull();
    expect(changed!.components["b1"]!.placement.rotation).toBe(270);
  });

  it("flipSelection mirrors the selection's extent horizontally", async () => {
    const el = await mount(tinyLayout());
    el.setSelection(["c:b1"]);
    let changed: DiagramLayout | null = null;
    el.addEventListener("om-graphical-layout-change", (e) => {
      changed = (e as CustomEvent<DiagramLayout>).detail;
    });

    el.flipSelection(true);

    expect(changed).not.toBeNull();
    expect(changed!.components["b1"]!.placement.extent).toEqual([
      [10, -5],
      [-10, 5],
    ]);
  });

  it("rotateSelection is a no-op with no selection", async () => {
    const el = await mount(tinyLayout());
    let fired = false;
    el.addEventListener("om-graphical-layout-change", () => {
      fired = true;
    });
    el.rotateSelection(true);
    expect(fired).toBe(false);
  });
});
