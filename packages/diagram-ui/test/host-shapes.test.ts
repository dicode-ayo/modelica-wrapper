import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { diagram, ModelInstanceSchema } from "@dicode/omc-client";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";
import type { OmScene } from "../src/scene/scene.component.js";

function layoutWithHostShapes(): DiagramLayout {
  return {
    kind: "diagram",
    className: "T",
    source: { file: "T.mo", line: 1, column: 1 } as never,
    iconLayers: [],
    diagramLayers: [
      {
        from: "T",
        shapes: [
          {
            kind: "rectangle",
            extent: [
              [-50, -50],
              [50, 50],
            ],
            lineColor: [255, 0, 0],
            fillPattern: "None",
            pattern: "Solid",
          },
          {
            kind: "text",
            extent: [
              [-20, 60],
              [20, 70],
            ],
            textString: "PID Controller" as never,
            textColor: [255, 0, 0],
          },
          {
            kind: "line",
            points: [
              [-30, 0],
              [30, 0],
            ],
            color: [255, 0, 0],
          },
        ],
      },
    ],
    labels: [],
    classes: {},
    components: {},
    connectors: {},
    connections: [],
  };
}

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) t();
});

async function mount(layout: DiagramLayout): Promise<OmGraphicalLayout> {
  const el = document.createElement("om-graphical-layout") as OmGraphicalLayout;
  // Renderer-less: build the Pixi container tree on the CPU, no GPU context.
  el.rendererFactory = () => null;
  el.layout = layout;
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

/** Every container in the scene's diagram subtree. */
function diagramContainers(el: OmGraphicalLayout): Container[] {
  const sceneEl = el.shadowRoot?.querySelector("om-scene") as OmScene | null;
  const root = sceneEl?.sceneContextValue?.diagramRoot;
  if (!root) return [];
  const out: Container[] = [];
  const walk = (c: Container): void => {
    for (const child of c.children) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

describe("<om-graphical-layout> host shapes", () => {
  it("emits primitive children for the host's diagram shapes", async () => {
    const el = await mount(layoutWithHostShapes());
    const shadowRoot = el.shadowRoot;
    if (!shadowRoot) throw new Error("no shadowRoot");
    const inner = shadowRoot.innerHTML;
    const rects = shadowRoot.querySelectorAll("om-rectangle");
    const texts = shadowRoot.querySelectorAll("om-text");
    const lines = shadowRoot.querySelectorAll("om-line");
    expect(
      { rects: rects.length, texts: texts.length, lines: lines.length },
      `shadow HTML:\n${inner}`,
    ).toEqual({ rects: 1, texts: 1, lines: 1 });
  });

  it("actually builds Pixi graphics for the host's shapes", async () => {
    const el = await mount(layoutWithHostShapes());
    // Wait an extra tick so the primitives' @consume callback fires
    // after om-scene's mount() has provided the parentNode context.
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    const names = diagramContainers(el).map((c) => c.label);
    const rectFromHost = names.some((n) => n.startsWith("om-rectangle"));
    const lineFromHost = names.some((n) => n.startsWith("om-line"));
    const textFromHost = names.some((n) => n.startsWith("om-text"));
    expect(
      { rect: rectFromHost, line: lineFromHost, text: textFromHost },
      `scene containers:\n${names.join("\n")}`,
    ).toEqual({ rect: true, line: true, text: true });
  });

  it("renders host shapes from the real PID_Controller fixture", async () => {
    const raw = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          "../stories/fixtures/pidController.modelInstance.json",
        ),
        "utf8",
      ),
    );
    const instance = ModelInstanceSchema.parse(raw);
    const layout = diagram.produceDiagramLayout(instance, "diagram");
    // Sanity: the fixture must actually contain the 6 host shapes the
    // OMEdit screenshot promises — 2 rectangles, 3 texts, 1 line.
    const shapes = layout.diagramLayers.flatMap((l) => l.shapes);
    expect(shapes.map((s) => s.kind).sort()).toEqual(
      ["line", "rectangle", "rectangle", "text", "text", "text"].sort(),
    );
    const el = await mount(layout);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    const shadowRoot = el.shadowRoot;
    if (!shadowRoot) throw new Error("no shadowRoot");
    const rects = shadowRoot.querySelectorAll("om-rectangle");
    const texts = shadowRoot.querySelectorAll("om-text");
    const lines = shadowRoot.querySelectorAll("om-line");
    // The DOM-level count of primitives directly under <om-scene> must
    // match the host's diagramLayers (sub-component icons add more
    // primitives via their own <om-component>s, which we filter out by
    // checking parent).
    const hostOnly = <T extends Element>(nodes: NodeListOf<T>): T[] =>
      Array.from(nodes).filter((n) => n.parentElement?.tagName === "OM-SCENE");
    expect({
      rects: hostOnly(rects).length,
      texts: hostOnly(texts).length,
      lines: hostOnly(lines).length,
    }).toEqual({ rects: 2, texts: 3, lines: 1 });
  });
});
