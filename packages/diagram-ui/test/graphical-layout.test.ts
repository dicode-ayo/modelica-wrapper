import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";
import type { OmScene } from "../src/scene/scene.component.js";

/** The canvas lives in `<om-scene>`'s shadow root, one level down. */
function sceneCanvas(el: OmGraphicalLayout): HTMLCanvasElement {
  const scene = el.shadowRoot?.querySelector("om-scene") as OmScene | null;
  const canvas = scene?.canvasElement;
  if (!canvas) {
    throw new Error("scene canvas not mounted");
  }
  return canvas;
}

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

/** Two `Test.Block` instances side by side, for multi-select tests. */
function twoBlockLayout(): DiagramLayout {
  const l = tinyLayout();
  return {
    ...l,
    components: {
      ...l.components,
      b2: {
        name: "b2",
        classRef: "Test.Block",
        placement: {
          extent: [
            [30, -5],
            [50, 5],
          ],
        },
      },
    },
  };
}

/** Two blocks joined by one connection, for connection-selection tests. */
function connectedLayout(): DiagramLayout {
  const l = twoBlockLayout();
  return {
    ...l,
    connections: [
      {
        lhs: { component: "b1", port: "p" },
        rhs: { component: "b2", port: "p" },
        waypoints: [
          [0, 0],
          [40, 0],
        ],
      },
    ],
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
    const root = el.shadowRoot;
    if (root === null) {
      throw new Error("shadow root not attached");
    }
    const inner = root.innerHTML;
    const comps = root.querySelectorAll("om-component");
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

  it("copy then paste emits one offset add-component request per selected component", async () => {
    const el = await mount(twoBlockLayout());
    const requests: Array<{
      className: string;
      position: { x: number; y: number };
    }> = [];
    el.addEventListener("om-add-component-request", (e) => {
      const d = (e as CustomEvent).detail as {
        className: string;
        position: { x: number; y: number };
      };
      requests.push(d);
    });
    el.setSelection(["c:b1", "c:b2"]);
    const canvas = sceneCanvas(el);

    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true }),
    );
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true }),
    );

    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.className).sort()).toEqual([
      "Test.Block",
      "Test.Block",
    ]);
    // Both pasted instances are shifted clear of their source centres
    // (b1 centre 0,0; b2 centre 40,0) by the same paste step.
    const [b1Paste, b2Paste] = requests;
    if (b1Paste === undefined || b2Paste === undefined) {
      throw new Error("expected two paste requests");
    }
    expect(b1Paste.position.x).toBeGreaterThan(0);
    expect(b1Paste.position.y).toBeLessThan(0);
    expect(b2Paste.position.x - b1Paste.position.x).toBe(40);
  });

  it("tags a connection's edge with its canonical selection key so clicks select it", async () => {
    const el = await mount(connectedLayout());
    const conn = el.shadowRoot?.querySelector("om-connection");
    if (!conn) {
      throw new Error("expected an om-connection");
    }
    const edge = conn.shadowRoot?.querySelector("om-edge");
    if (!edge) {
      throw new Error("expected an om-edge under the connection");
    }
    // The edge mesh advertises this nodeId; a pick must resolve to the
    // bare `edge:0` key that the highlight and whole-connection delete
    // address — a `0/edge` suffix would select nothing.
    expect(edge.nodeId).toBe("0");

    // Round-trip: selecting that key highlights the edge.
    el.setSelection(["edge:0"]);
    await el.updateComplete;
    await conn.updateComplete;
    expect(edge.selected).toBe(true);
  });

  it("paste with an empty clipboard emits nothing", async () => {
    const el = await mount(twoBlockLayout());
    let count = 0;
    el.addEventListener("om-add-component-request", () => {
      count += 1;
    });
    const canvas = sceneCanvas(el);
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true }),
    );
    expect(count).toBe(0);
  });
});
