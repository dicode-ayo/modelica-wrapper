import { afterEach, describe, expect, it } from "vitest";
import type { Container } from "pixi.js";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";
import { HOST_SHAPE_Z_BIAS } from "../src/graphical-layout/graphical-layout.component.js";
import { entityKeyForNode } from "../src/interaction/node-keys.js";
import { zForOrder } from "../src/primitives/shape-utils.js";
import type { OmScene } from "../src/scene/scene.component.js";

/**
 * `T` owns a diagram layer (`from: "T"`) with a rectangle + a line, plus an
 * inherited layer (`from: "Base"`) whose shape must NOT become selectable,
 * and a component `R1` to pin pick priority against.
 */
function layout(): DiagramLayout {
  return {
    kind: "diagram",
    className: "T",
    source: { file: "T.mo", line: 1, column: 1 } as never,
    iconLayers: [],
    diagramLayers: [
      {
        from: "Base",
        shapes: [
          {
            kind: "rectangle",
            extent: [
              [-9, -9],
              [9, 9],
            ],
            fillColor: [255, 255, 255],
            fillPattern: "Solid",
          },
        ],
      },
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
    components: {
      R1: {
        name: "R1",
        classRef: "Demo.R",
        placement: {
          extent: [
            [-10, -10],
            [10, 10],
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
  for (const t of teardowns.splice(0)) t();
});

async function mount(
  l: DiagramLayout,
  opts?: { readonly?: boolean },
): Promise<OmGraphicalLayout> {
  const el = document.createElement("om-graphical-layout") as OmGraphicalLayout;
  // Renderer-less: build the Pixi container tree on the CPU, no GPU context.
  el.rendererFactory = () => null;
  el.readonly = opts?.readonly ?? false;
  el.layout = l;
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

function diagramRootOf(el: OmGraphicalLayout): Container | null {
  const sceneEl = el.shadowRoot?.querySelector("om-scene") as OmScene | null;
  return sceneEl?.sceneContextValue?.diagramRoot ?? null;
}

/** Every container in the scene's diagram subtree. */
function containers(el: OmGraphicalLayout): Container[] {
  const root = diagramRootOf(el);
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

function byLabel(el: OmGraphicalLayout, label: string): Container | undefined {
  return containers(el).find((c) => c.label === label);
}

/** Visible resize-corner handle containers currently in the scene. */
function visibleResizeHandles(el: OmGraphicalLayout): number {
  return containers(el).filter(
    (c) => c.visible && c.label.startsWith("om-handle:"),
  ).length;
}

/** Visible per-vertex handle containers currently in the scene. */
function visibleVertexHandles(el: OmGraphicalLayout): number {
  return containers(el).filter(
    (c) => c.visible && c.label.startsWith("om-vertex-handle"),
  ).length;
}

describe("host shape selection entities", () => {
  it("emits an editable primitive per OWN shape, none for inherited layers", async () => {
    const el = await mount(layout());
    const root = el.shadowRoot;
    // Each own shape is its own editable primitive (rectangle + line); the
    // inherited `Base` rectangle gets none.
    expect(root?.querySelectorAll("om-rectangle[editable]").length).toBe(1);
    expect(root?.querySelectorAll("om-line[editable]").length).toBe(1);
  });

  it("names each entity om-shape:<kind>:<index> so picks resolve to a shape key", async () => {
    const el = await mount(layout());
    const rectWrapper = byLabel(el, "om-shape:rectangle:0");
    const lineWrapper = byLabel(el, "om-shape:line:1");
    expect(rectWrapper, "rectangle wrapper").toBeDefined();
    expect(lineWrapper, "line wrapper").toBeDefined();

    // The pickable hit plane lives under the wrapper; resolve a key from it.
    const hitPlane = rectWrapper?.children.find(
      (c) => c.eventMode === "static",
    );
    expect(hitPlane, "pickable hit plane").toBeDefined();
    expect(entityKeyForNode(hitPlane ?? null)).toEqual({
      kind: "shape",
      nodeId: "rectangle:0",
      shapeKind: "rectangle",
      index: 0,
    });
  });

  it("seats host-shape entities behind components via the z-bias band", async () => {
    const el = await mount(layout());
    const shapeZ = byLabel(el, "om-shape:rectangle:0")?.zIndex;
    const componentZ = byLabel(el, "om-component:R1")?.zIndex;
    // The entity's zIndex folds its flat draw order (index 1, after the
    // inherited Base rectangle) into the z-bias band; the component sits at 0.
    expect(shapeZ).toBeCloseTo(zForOrder(1) - HOST_SHAPE_Z_BIAS, 5);
    expect(componentZ).toBeCloseTo(0);
    // Higher zIndex paints in front, so the component wins a coincident pick.
    expect(componentZ ?? 0).toBeGreaterThan(shapeZ ?? 0);
  });

  it("shows resize handles for a selected extent shape but not a poly", async () => {
    const el = await mount(layout());

    el.setSelection(["shape:rectangle:0"]);
    await el.updateComplete;
    expect(visibleResizeHandles(el)).toBe(4);

    el.setSelection(["shape:line:1"]);
    await el.updateComplete;
    expect(visibleResizeHandles(el)).toBe(0);
  });

  it("picks a poly along a follow-the-line hit tube, not the bbox plane", async () => {
    const el = await mount(layout());
    const lineWrapper = byLabel(el, "om-shape:line:1");
    const children = lineWrapper?.children ?? [];
    // The bbox hit plane is no longer the pick target for a polyline…
    const plane = children.find((c) => c.label === "plane.om-shape:line:1");
    expect(plane?.eventMode).toBe("none");
    // …a hit tube tracing the segments is, and it resolves to the shape key.
    const tube = children.find((c) =>
      c.label.startsWith("hit.om-shape:line:1"),
    );
    expect(tube?.eventMode).toBe("static");
    expect(entityKeyForNode(tube ?? null)).toMatchObject({
      kind: "shape",
      shapeKind: "line",
      index: 1,
    });
  });

  it("shows a vertex handle per point on a selected poly, none on an extent shape", async () => {
    const el = await mount(layout());

    // The line has two points → two vertex handles; no resize handles.
    el.setSelection(["shape:line:1"]);
    await el.updateComplete;
    expect(visibleVertexHandles(el)).toBe(2);

    // The rectangle is extent-edited → no vertex handles.
    el.setSelection(["shape:rectangle:0"]);
    await el.updateComplete;
    expect(visibleVertexHandles(el)).toBe(0);
  });

  it("does not double-apply rotation: the editable visual draws in the entity frame", async () => {
    const rotated: DiagramLayout = {
      ...layout(),
      diagramLayers: [
        {
          from: "T",
          shapes: [
            {
              kind: "line",
              rotation: 90,
              points: [
                [10, 0],
                [20, 0],
              ],
            },
          ],
        },
      ],
    };
    const el = await mount(rotated);
    // The entity transform carries the 90° rotation once…
    const wrapper = byLabel(el, "om-shape:line:0");
    expect(wrapper?.rotation).toBeCloseTo(Math.PI / 2);
    // …so the primitive must NOT also wrap the stroke in its own
    // origin/rotation `graphicItemNode` — that would rotate it twice.
    expect(containers(el).some((c) => c.label.endsWith(".gi"))).toBe(false);
  });

  it("paints host shapes in flat annotation-array order, below components", async () => {
    const el = await mount(layout());
    // The inherited Base fill (flat index 0) paints at the bottom of the
    // host-shape band…
    const inherited = byLabel(el, "om-rectangle.0.fill")?.zIndex ?? NaN;
    expect(inherited).toBeCloseTo(zForOrder(0) - HOST_SHAPE_Z_BIAS, 5);
    // …the own rectangle (flat 1) and line (flat 2) above it, still below
    // the component band at 0 — so a PID-style inherited background fill
    // can't paint over the shapes the annotation lists after it.
    const ownRect = byLabel(el, "om-shape:rectangle:0")?.zIndex ?? NaN;
    const ownLine = byLabel(el, "om-shape:line:1")?.zIndex ?? NaN;
    expect(ownRect).toBeGreaterThan(inherited);
    expect(ownLine).toBeGreaterThan(ownRect);
    expect(ownLine).toBeLessThan(0);
  });

  it("keeps own shapes selectable when readonly, without edit handles", async () => {
    // Selecting a graphic to copy it is not an edit — a read-only class is
    // exactly what you copy from, so the entity has to survive. Only the
    // hover-revealed handles go.
    const el = await mount(layout(), { readonly: true });
    expect(byLabel(el, "om-shape:rectangle:0")).toBeDefined();

    const entities = [
      ...(el.shadowRoot?.querySelectorAll("[editable]") ?? []),
    ] as { editHandles?: boolean }[];
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.every((p) => p.editHandles === false)).toBe(true);

    // Still painted in its flat order within the host-shape z band, exactly
    // where the writable entity sits.
    expect(byLabel(el, "om-shape:rectangle:0")?.zIndex).toBeCloseTo(
      zForOrder(1) - HOST_SHAPE_Z_BIAS,
      5,
    );
    expect(byLabel(el, "om-shape:line:1")).toBeDefined();
  });

  it("shows no resize or vertex handles for a selection on a readonly class", async () => {
    // The entity exists so the shape can be picked and copied; the handles
    // would offer edits `onDrag` refuses anyway.
    const el = await mount(layout(), { readonly: true });

    el.setSelection(["shape:rectangle:0"]);
    await el.updateComplete;
    expect(visibleResizeHandles(el)).toBe(0);

    el.setSelection(["shape:line:1"]);
    await el.updateComplete;
    expect(visibleVertexHandles(el)).toBe(0);
  });

  it("keeps edit handles on a writable class", async () => {
    const el = await mount(layout());
    const entities = [
      ...(el.shadowRoot?.querySelectorAll("[editable]") ?? []),
    ] as { editHandles?: boolean }[];
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.every((p) => p.editHandles !== false)).toBe(true);
  });

  it("seats an extent shape at its origin and pivots its rotation there", async () => {
    const rotated: DiagramLayout = {
      ...layout(),
      diagramLayers: [
        {
          from: "T",
          shapes: [
            {
              kind: "rectangle",
              origin: [20, 10],
              rotation: 90,
              extent: [
                [-5, -5],
                [5, 5],
              ],
            },
          ],
        },
      ],
    };
    const el = await mount(rotated);
    const wrapper = byLabel(el, "om-shape:rectangle:0");
    // Modelica rotates about `origin`: the entity transform sits at the
    // origin and carries the rotation, not the extent centre.
    expect(wrapper?.position.x).toBeCloseTo(20);
    expect(wrapper?.position.y).toBeCloseTo(10);
    expect(wrapper?.zIndex).toBeCloseTo(-HOST_SHAPE_Z_BIAS);
    expect(wrapper?.rotation).toBeCloseTo(Math.PI / 2);
  });
});
