import { afterEach, describe, expect, it } from "vitest";
import { NullEngine, type TransformNode } from "@babylonjs/core";
import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { OmGraphicalLayout } from "../src/graphical-layout/graphical-layout.component.js";
import { HOST_SHAPE_Z_BIAS } from "../src/host-shape/host-shape.component.js";
import { entityKeyForNode } from "../src/interaction/node-keys.js";

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

async function mount(l: DiagramLayout): Promise<OmGraphicalLayout> {
  const el = document.createElement("om-graphical-layout") as OmGraphicalLayout;
  el.engineFactory = () =>
    new NullEngine({
      renderWidth: 200,
      renderHeight: 200,
      textureSize: 128,
      deterministicLockstep: false,
      lockstepMaxSteps: 1,
    });
  el.layout = l;
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

interface SceneHandle extends HTMLElement {
  sceneContextValue?: {
    scene: {
      transformNodes: TransformNode[];
      meshes: { name: string; isVisible: boolean }[];
    };
  };
}

function sceneOf(el: OmGraphicalLayout) {
  const sceneEl = el.shadowRoot?.querySelector(
    "om-scene",
  ) as SceneHandle | null;
  return sceneEl?.sceneContextValue?.scene;
}

function transformNodes(el: OmGraphicalLayout): TransformNode[] {
  return sceneOf(el)?.transformNodes ?? [];
}

/** Visible resize-corner handle meshes currently in the scene. */
function visibleResizeHandles(el: OmGraphicalLayout): number {
  return (sceneOf(el)?.meshes ?? []).filter(
    (m) => m.isVisible && m.name.startsWith("om-handle:"),
  ).length;
}

/** Visible per-vertex handle meshes currently in the scene. */
function visibleVertexHandles(el: OmGraphicalLayout): number {
  return (sceneOf(el)?.meshes ?? []).filter(
    (m) => m.isVisible && m.name === "om-vertex-handle",
  ).length;
}

describe("<om-host-shape> selection entities", () => {
  it("emits an entity per OWN shape (host-shape for extents, editable primitive for polys)", async () => {
    const el = await mount(layout());
    const root = el.shadowRoot;
    // The rectangle is an <om-host-shape>; the line is its own editable
    // <om-line>. The inherited `Base` rectangle gets neither.
    expect(root?.querySelectorAll("om-host-shape").length).toBe(1);
    expect(root?.querySelectorAll("om-line[editable]").length).toBe(1);
  });

  it("names each wrapper om-shape:<kind>:<index> so picks resolve to a shape key", async () => {
    const el = await mount(layout());
    const nodes = transformNodes(el);
    const rectWrapper = nodes.find((n) => n.name === "om-shape:rectangle:0");
    const lineWrapper = nodes.find((n) => n.name === "om-shape:line:1");
    expect(rectWrapper, "rectangle wrapper").toBeDefined();
    expect(lineWrapper, "line wrapper").toBeDefined();

    // The pickable hit plane lives under the wrapper; resolve a key from it.
    const hitPlane = rectWrapper?.getChildMeshes().find((m) => m.isPickable);
    expect(hitPlane, "pickable hit plane").toBeDefined();
    expect(entityKeyForNode(hitPlane ?? null)).toEqual({
      kind: "shape",
      nodeId: "rectangle:0",
      shapeKind: "rectangle",
      index: 0,
    });
  });

  it("seats host-shape hit planes behind components via the z-bias", async () => {
    const el = await mount(layout());
    const nodes = transformNodes(el);
    const shapeZ = nodes.find((n) => n.name === "om-shape:rectangle:0")
      ?.position.z;
    const componentZ = nodes.find((n) => n.name === "om-component:R1")?.position
      .z;
    expect(shapeZ).toBeCloseTo(HOST_SHAPE_Z_BIAS);
    expect(componentZ).toBeCloseTo(0);
    // Camera at -Z: larger z = farther, so the component wins a coincident pick.
    expect(shapeZ ?? 0).toBeGreaterThan(componentZ ?? 0);
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
    const lineWrapper = transformNodes(el).find(
      (n) => n.name === "om-shape:line:1",
    );
    const meshes = lineWrapper?.getChildMeshes() ?? [];
    // The bbox hit plane is no longer the pick target for a polyline…
    expect(
      meshes.find((m) => m.name === "plane.om-shape:line:1")?.isPickable,
    ).toBe(false);
    // …a hit tube tracing the segments is, and it resolves to the shape key.
    const tube = meshes.find((m) => m.name.startsWith("hit.om-shape:line:1"));
    expect(tube?.isPickable).toBe(true);
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
    const nodes = transformNodes(el);
    // The entity transform carries the 90° rotation once…
    const wrapper = nodes.find((n) => n.name === "om-shape:line:0");
    expect(wrapper?.rotation.z).toBeCloseTo(Math.PI / 2);
    // …so the primitive must NOT also wrap the stroke in its own
    // origin/rotation `graphicItemNode` — that would rotate it twice.
    expect(nodes.some((n) => n.name.endsWith(".gi"))).toBe(false);
  });
});
