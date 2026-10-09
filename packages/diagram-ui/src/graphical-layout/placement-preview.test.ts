import { describe, expect, it } from "vitest";
import type { ClassDef, DiagramLayout } from "@dicode/omc-client";
import { classNameOf } from "@dicode/omc-client/layout";

import {
  PLACEMENT_HALF_EXTENT,
  PLACEMENT_PREVIEW_ID,
  buildPlacementPreview,
} from "./placement-preview.js";

function baseLayout(): DiagramLayout {
  return {
    kind: "diagram",
    className: "Test",
    source: {
      filename: "Test.mo",
      lineStart: 1,
      columnStart: 1,
      lineEnd: 1,
      columnEnd: 1,
    },
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {},
    components: {},
    connectors: {},
    connections: [],
  } as unknown as DiagramLayout;
}

const gain: ClassDef = {
  name: "Modelica.Blocks.Math.Gain",
  restriction: "block",
  iconLayers: [{ from: "Modelica.Blocks.Math.Gain", shapes: [] }],
  connectors: { u: {} as never, y: {} as never },
  parameters: {},
};

/** The preview component's class key resolves to `classDef`. */
function expectPreviewClass(layout: DiagramLayout, classDef: ClassDef): void {
  const ref = layout.components[PLACEMENT_PREVIEW_ID]?.classRef ?? "";
  expect(layout.classes[ref]).toBe(classDef);
  expect(classNameOf(layout, ref)).toBe(classDef.name);
}

describe("buildPlacementPreview", () => {
  it("injects the class and a square instance at the point", () => {
    const layout = buildPlacementPreview(baseLayout(), gain, { x: 40, y: 25 });

    expectPreviewClass(layout, gain);
    const h = PLACEMENT_HALF_EXTENT;
    expect(layout.components[PLACEMENT_PREVIEW_ID]?.placement.extent).toEqual([
      [40 - h, 25 - h],
      [40 + h, 25 + h],
    ]);
  });

  it("does not mutate the base layout", () => {
    const base = baseLayout();
    buildPlacementPreview(base, gain, { x: 0, y: 0 });

    expect(base.components).toEqual({});
    expect(base.classes).toEqual({});
  });

  it("keeps the base layout's own components and classes", () => {
    const base = baseLayout();
    base.components = { r1: { name: "r1", classRef: "R" } as never };
    base.classes = { R: { name: "R" } as never };

    const layout = buildPlacementPreview(base, gain, { x: 0, y: 0 });

    expect(Object.keys(layout.components).sort()).toEqual([
      PLACEMENT_PREVIEW_ID,
      "r1",
    ]);
    expect(layout.classes["R"]).toBe(base.classes["R"]);
    expectPreviewClass(layout, gain);
    expect(Object.keys(layout.classes)).toHaveLength(2);
  });

  it("leaves the diagram's own entries for the dragged class untouched", () => {
    const torque = (useSupport: boolean): ClassDef => ({
      name: "Modelica.Mechanics.Rotational.Sources.Torque",
      restriction: "model",
      iconLayers: [],
      connectors: useSupport
        ? { flange: {} as never, support: {} as never }
        : { flange: {} as never },
      parameters: {},
    });
    const withSupport = torque(true);
    const withoutSupport = torque(false);
    const base = baseLayout();
    base.classes = {
      [withSupport.name]: withSupport,
      [`${withSupport.name}#2`]: withoutSupport,
    };
    base.components = {
      t1: { name: "t1", classRef: withSupport.name } as never,
      t2: { name: "t2", classRef: `${withSupport.name}#2` } as never,
    };
    const dragged: ClassDef = {
      ...torque(true),
      iconLayers: [{ from: withSupport.name, shapes: [] }],
    };

    const layout = buildPlacementPreview(base, dragged, { x: 0, y: 0 });

    expect(layout.classes[withSupport.name]).toBe(withSupport);
    expect(layout.classes[`${withSupport.name}#2`]).toBe(withoutSupport);
    expectPreviewClass(layout, dragged);
  });
});
