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

function transformNodes(el: OmGraphicalLayout): TransformNode[] {
  const sceneEl = el.shadowRoot?.querySelector("om-scene") as
    | (HTMLElement & {
        sceneContextValue?: { scene: { transformNodes: TransformNode[] } };
      })
    | null;
  return sceneEl?.sceneContextValue?.scene.transformNodes ?? [];
}

describe("<om-host-shape> selection entities", () => {
  it("emits one entity per OWN shape, never for inherited layers", async () => {
    const el = await mount(layout());
    const entities = el.shadowRoot?.querySelectorAll("om-host-shape") ?? [];
    // 2 own shapes (rectangle + line); the inherited `Base` rectangle gets none.
    expect(entities.length).toBe(2);
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
});
