import { describe, expect, it } from "vitest";
import type { ClassDef, DiagramLayout } from "@dicode/omc-client";

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

describe("buildPlacementPreview", () => {
  it("injects the class and a square instance at the point", () => {
    const layout = buildPlacementPreview(baseLayout(), gain, { x: 40, y: 25 });

    expect(layout.classes[gain.name]).toBe(gain);
    const preview = layout.components[PLACEMENT_PREVIEW_ID];
    expect(preview?.classRef).toBe(gain.name);
    const h = PLACEMENT_HALF_EXTENT;
    expect(preview?.placement.extent).toEqual([
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
    expect(Object.keys(layout.classes).sort()).toEqual([
      "Modelica.Blocks.Math.Gain",
      "R",
    ]);
  });
});
