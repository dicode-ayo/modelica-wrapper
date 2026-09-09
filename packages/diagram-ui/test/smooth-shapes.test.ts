/**
 * `Smooth.Bezier` reaches the Pixi renderer: `<om-line>` and `<om-polygon>`
 * stroke the flattened curve rather than the raw control polygon, so an
 * interior vertex becomes a rounded corner the path never touches — and the
 * follow-the-line hit tube tracks the curve, since its 1.5-unit radius is far
 * narrower than the gap a smoothed vertex opens. The geometry itself is
 * pinned in `@dicode/diagram-svg`; these pin the wiring.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Container, Graphics } from "pixi.js";
import type { DiagramLayout, Shape } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import { applyShapeSmoothToggle } from "../src/interaction/layout-ops.js";
import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";
import type { OmScene } from "../src/scene/scene.component.js";

const APEX: readonly [number, number] = [0, 50];

function layout(shape: Shape): DiagramLayout {
  return {
    kind: "diagram",
    className: "T",
    source: { file: "T.mo", line: 1, column: 1 } as never,
    iconLayers: [],
    diagramLayers: [{ from: "T", shapes: [shape] }],
    labels: [],
    classes: {},
    components: {},
    connectors: {},
    connections: [],
  };
}

function arc(smooth: string | undefined): DiagramLayout {
  return layout({
    kind: "line",
    points: [[-50, 0], APEX as [number, number], [50, 0]],
    color: [255, 0, 0],
    thickness: 2,
    ...(smooth !== undefined ? { smooth } : {}),
  });
}

function triangle(smooth: string | undefined): DiagramLayout {
  return layout({
    kind: "polygon",
    points: [[-50, -50], [50, -50], APEX as [number, number], [-50, -50]],
    lineColor: [255, 0, 0],
    fillPattern: "None",
    lineThickness: 2,
    ...(smooth !== undefined ? { smooth } : {}),
  });
}

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) t();
});

async function mount(l: DiagramLayout): Promise<OmGraphicalLayout> {
  const el = document.createElement("om-graphical-layout") as OmGraphicalLayout;
  el.rendererFactory = () => null;
  el.readonly = false;
  el.layout = l;
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

function graphicsWithLabel(el: OmGraphicalLayout, label: string): Graphics {
  const scene = el.shadowRoot?.querySelector("om-scene") as OmScene | null;
  const root = scene?.sceneContextValue?.diagramRoot;
  if (!root) throw new Error("expected a diagram root");
  const found: Container[] = [];
  const walk = (c: Container): void => {
    for (const child of c.children) {
      found.push(child);
      walk(child);
    }
  };
  walk(root);
  const g = found.find((c) => c.label === label && c instanceof Graphics);
  if (!(g instanceof Graphics)) throw new Error(`expected the ${label} stroke`);
  return g;
}

/** The `moveTo`/`lineTo` vertices Pixi batched into the stroke's path. */
function strokeVertices(g: Graphics): Array<[number, number]> {
  type PathInstruction = { action: string; data: unknown };
  type StrokeInstruction = {
    action: string;
    data: { path?: { instructions: PathInstruction[] } };
  };
  return (g.context.instructions as ReadonlyArray<StrokeInstruction>)
    .flatMap((i) => i.data.path?.instructions ?? [])
    .filter((i) => i.action === "moveTo" || i.action === "lineTo")
    .map((i) => {
      const [x, y] = i.data as [number, number];
      return [x, y] as [number, number];
    });
}

function contains(
  vertices: ReadonlyArray<readonly [number, number]>,
  target: readonly [number, number],
): boolean {
  return vertices.some(([x, y]) => x === target[0] && y === target[1]);
}

describe.each([
  {
    kind: "line",
    build: arc,
    label: "om-line.0",
    hit: "hit.om-shape:line:0",
  },
  {
    kind: "polygon",
    build: triangle,
    label: "om-polygon.0.stroke",
    hit: "hit.om-shape:polygon:0",
  },
])("$kind Smooth.Bezier", ({ build, label, hit }) => {
  it("strokes the control polygon verbatim without smoothing", async () => {
    const vertices = strokeVertices(
      graphicsWithLabel(await mount(build(undefined)), label),
    );
    expect(contains(vertices, APEX)).toBe(true);
  });

  it("rounds the apex away and stays inside the control hull", async () => {
    const vertices = strokeVertices(
      graphicsWithLabel(await mount(build("Bezier")), label),
    );
    expect(contains(vertices, APEX)).toBe(false);
    expect(vertices.length).toBeGreaterThan(8);
    for (const [x, y] of vertices) {
      expect(Math.abs(x)).toBeLessThanOrEqual(50);
      expect(y).toBeLessThanOrEqual(50);
    }
  });

  it("runs the hit tube along the curve rather than the control polygon", async () => {
    const el = await mount(build("Bezier"));
    const drawn = strokeVertices(graphicsWithLabel(el, label));
    expect(strokeVertices(graphicsWithLabel(el, hit))).toEqual(drawn);
  });
});

describe("toggling smooth on a live shape", () => {
  it("re-traces the hit tube, not just the paint", async () => {
    // `applyShapeSmoothToggle` spreads the shape, so the toggled layout
    // carries the very same `points` array — the tube must still rebuild.
    const straight = arc(undefined);
    const el = await mount(straight);
    const before = strokeVertices(graphicsWithLabel(el, "hit.om-shape:line:0"));
    expect(contains(before, APEX)).toBe(true);

    el.layout = applyShapeSmoothToggle(straight, "shape:line:0");
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));

    const after = strokeVertices(graphicsWithLabel(el, "hit.om-shape:line:0"));
    expect(contains(after, APEX)).toBe(false);
    expect(after).toEqual(strokeVertices(graphicsWithLabel(el, "om-line.0")));
  });
});

describe("two-point Smooth.Bezier line", () => {
  it("stays a straight segment between its endpoints", async () => {
    const el = await mount(
      layout({
        kind: "line",
        points: [
          [-50, 0],
          [50, 0],
        ],
        color: [255, 0, 0],
        thickness: 2,
        smooth: "Bezier",
      }),
    );
    expect(strokeVertices(graphicsWithLabel(el, "om-line.0"))).toEqual([
      [-50, 0],
      [50, 0],
    ]);
  });
});
