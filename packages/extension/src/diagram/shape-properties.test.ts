import { describe, expect, it } from "vitest";

import {
  applyShapeProperties,
  buildShapePropertiesForm,
  colorToHex,
  hexToColor,
  lookupHostShape,
} from "./shape-properties.js";

import type {
  DiagramLayout,
  ParameterField,
  RectangleShape,
  Shape,
} from "@dicode/omc-client";

// ── colorToHex ────────────────────────────────────────────────────────────────

describe("colorToHex", () => {
  it("converts black", () => {
    expect(colorToHex([0, 0, 0])).toBe("#000000");
  });

  it("converts white", () => {
    expect(colorToHex([255, 255, 255])).toBe("#ffffff");
  });

  it("converts a mixed color", () => {
    expect(colorToHex([0, 128, 255])).toBe("#0080ff");
  });

  it("clamps channels to 0-255", () => {
    expect(
      colorToHex([-10, 0, 300] as unknown as [number, number, number]),
    ).toBe("#0000ff");
  });
});

// ── hexToColor ────────────────────────────────────────────────────────────────

describe("hexToColor", () => {
  it("converts #000000 to black", () => {
    expect(hexToColor("#000000")).toEqual([0, 0, 0]);
  });

  it("converts #ffffff to white", () => {
    expect(hexToColor("#ffffff")).toEqual([255, 255, 255]);
  });

  it("converts #0080ff", () => {
    expect(hexToColor("#0080ff")).toEqual([0, 128, 255]);
  });

  it("falls back to 0 for invalid channel bytes", () => {
    // Non-hex string → all channels NaN → all 0
    expect(hexToColor("#zzzzzz")).toEqual([0, 0, 0]);
  });

  it("round-trips with colorToHex", () => {
    const original = [10, 200, 50] as [number, number, number];
    expect(hexToColor(colorToHex(original))).toEqual(original);
  });
});

// ── lookupHostShape ───────────────────────────────────────────────────────────

const RECT: RectangleShape = {
  kind: "rectangle",
  extent: [
    [-40, -40],
    [40, 40],
  ],
  lineColor: [0, 0, 0],
};

function makeLayout(overrides: Partial<DiagramLayout> = {}): DiagramLayout {
  return {
    kind: "diagram",
    className: "MyClass",
    source: {
      filename: "MyClass.mo",
      lineStart: 1,
      columnStart: 1,
      lineEnd: 1,
      columnEnd: 1,
    },
    coordinateSystem: undefined,
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {},
    components: {},
    connectors: {},
    connections: [],
    resolvedParameters: undefined,
    ...overrides,
  } as unknown as DiagramLayout;
}

describe("lookupHostShape", () => {
  it("returns null for non-integer index", () => {
    const layout = makeLayout();
    expect(lookupHostShape(layout, NaN)).toBeNull();
    expect(lookupHostShape(layout, 1.5)).toBeNull();
    expect(lookupHostShape(layout, -1)).toBeNull();
  });

  it("finds a shape in diagramLayers", () => {
    const layout = makeLayout({
      diagramLayers: [{ from: "MyClass", shapes: [RECT] }],
    });
    const result = lookupHostShape(layout, 0);
    expect(result).not.toBeNull();
    expect(result?.shape).toBe(RECT);
    expect(result?.layerKind).toBe("diagram");
  });

  it("finds a shape in iconLayers when diagramLayers empty", () => {
    const layout = makeLayout({
      iconLayers: [{ from: "MyClass", shapes: [RECT] }],
    });
    const result = lookupHostShape(layout, 0);
    expect(result?.layerKind).toBe("icon");
    expect(result?.shape).toBe(RECT);
  });

  it("returns null when index is out of range", () => {
    const layout = makeLayout({
      diagramLayers: [{ from: "MyClass", shapes: [RECT] }],
    });
    expect(lookupHostShape(layout, 1)).toBeNull();
  });

  it("ignores ancestor layers (from !== className)", () => {
    const ancestorRect: RectangleShape = {
      kind: "rectangle",
      extent: [
        [0, 0],
        [10, 10],
      ],
    };
    const layout = makeLayout({
      diagramLayers: [
        { from: "BaseClass", shapes: [ancestorRect] },
        { from: "MyClass", shapes: [RECT] },
      ],
    });
    const result = lookupHostShape(layout, 0);
    expect(result?.shape).toBe(RECT);
  });

  it("rejects a shapeKind mismatch so a shifted index can't reroute a write", () => {
    const layout = makeLayout({
      diagramLayers: [{ from: "MyClass", shapes: [RECT] }],
    });
    expect(lookupHostShape(layout, 0, "line")).toBeNull();
    expect(lookupHostShape(layout, 0, "rectangle")?.shape).toBe(RECT);
  });
});

// ── buildShapePropertiesForm ──────────────────────────────────────────────────

describe("buildShapePropertiesForm", () => {
  it("emits model with className matching shape kind", () => {
    const model = buildShapePropertiesForm(RECT);
    expect(model.className).toBe("Rectangle");
  });

  it("includes visible and rotation fields", () => {
    const model = buildShapePropertiesForm(RECT);
    const names = model.fields.map((f) => f.name);
    expect(names).toContain("visible");
    expect(names).toContain("rotation");
  });

  it("rectangle form includes lineColor, fillColor, pattern, fillPattern, lineThickness, borderPattern, radius", () => {
    const model = buildShapePropertiesForm(RECT);
    const names = model.fields.map((f) => f.name);
    expect(names).toContain("lineColor");
    expect(names).toContain("fillColor");
    expect(names).toContain("pattern");
    expect(names).toContain("fillPattern");
    expect(names).toContain("lineThickness");
    expect(names).toContain("borderPattern");
    expect(names).toContain("radius");
  });

  it("seeds lineColor from the shape's color", () => {
    const model = buildShapePropertiesForm(RECT);
    const f = model.fields.find((x) => x.name === "lineColor");
    expect(f?.value).toBe("#000000");
  });

  it("line form includes color, thickness, pattern, smooth, arrowSize", () => {
    const line = {
      kind: "line" as const,
      points: [
        [0, 0],
        [10, 10],
      ] as [number, number][],
      color: [255, 0, 0] as [number, number, number],
      thickness: 0.5,
    };
    const model = buildShapePropertiesForm(line);
    const names = model.fields.map((f) => f.name);
    expect(names).toContain("color");
    expect(names).toContain("thickness");
    expect(names).toContain("pattern");
    expect(names).toContain("smooth");
    expect(names).toContain("arrowSize");
    const colorField = model.fields.find((x) => x.name === "color");
    expect(colorField?.value).toBe("#ff0000");
  });

  it("ellipse form includes startAngle, endAngle, closure", () => {
    const ellipse = {
      kind: "ellipse" as const,
      extent: [
        [-20, -20],
        [20, 20],
      ] as [[number, number], [number, number]],
      startAngle: 45,
      endAngle: 270,
    };
    const model = buildShapePropertiesForm(ellipse);
    const names = model.fields.map((f) => f.name);
    expect(names).toContain("startAngle");
    expect(names).toContain("endAngle");
    expect(names).toContain("closure");
    expect(model.fields.find((x) => x.name === "startAngle")?.value).toBe(45);
    expect(model.fields.find((x) => x.name === "endAngle")?.value).toBe(270);
  });

  it("text form exposes textString when it is a plain string", () => {
    const text = {
      kind: "text" as const,
      extent: [
        [-20, -10],
        [20, 10],
      ] as [[number, number], [number, number]],
      textString: "hello",
    };
    const model = buildShapePropertiesForm(text);
    const tf = model.fields.find((x) => x.name === "textString");
    expect(tf?.value).toBe("hello");
  });

  it("text form shows null for textString when it is a complex Expression", () => {
    const text = {
      kind: "text" as const,
      extent: [
        [-20, -10],
        [20, 10],
      ] as [[number, number], [number, number]],
      textString: {
        $kind: "call",
        name: "DynamicSelect",
        arguments: ["a", "b"],
      },
    };
    const model = buildShapePropertiesForm(
      text as unknown as Parameters<typeof buildShapePropertiesForm>[0],
    );
    const tf = model.fields.find((x) => x.name === "textString");
    expect(tf?.value).toBeNull();
  });

  it("enum fields carry enumChoices and enumTypeName", () => {
    const model = buildShapePropertiesForm(RECT);
    const patternField = model.fields.find((x) => x.name === "pattern");
    expect(patternField?.kind).toBe("enum");
    expect(patternField?.enumTypeName).toBe("LinePattern");
    expect(patternField?.enumChoices).toContain("Solid");
  });

  it("seeds a property the shape omits with its Modelica default", () => {
    const model = buildShapePropertiesForm(RECT);
    expect(model.fields.find((x) => x.name === "radius")?.value).toBe(0);
    expect(model.fields.find((x) => x.name === "visible")?.value).toBe(true);
  });

  it("leaves a colour the shape omits blank rather than seeding its default", () => {
    // Seeding it would make the next Apply write a colour the source never set.
    const fillColor = buildShapePropertiesForm(RECT).fields.find(
      (x) => x.name === "fillColor",
    );
    expect(fillColor?.value).toBeNull();
    expect(fillColor?.defaultValue).toBe("#0000ff");
    expect(
      (applyShapeProperties(RECT, { fillColor: null }) as RectangleShape)
        .fillColor,
    ).toBeUndefined();
  });
});

// ── applyShapeProperties ──────────────────────────────────────────────────────

describe("applyShapeProperties", () => {
  it("applies visible and rotation from submitted values", () => {
    const updated = applyShapeProperties(RECT, {
      visible: false,
      rotation: 45,
    });
    expect(updated).toMatchObject({ visible: false, rotation: 45 });
  });

  it("converts hex lineColor back to Color", () => {
    const updated = applyShapeProperties(RECT, { lineColor: "#ff0000" });
    expect((updated as RectangleShape).lineColor).toEqual([255, 0, 0]);
  });

  it("converts hex fillColor back to Color", () => {
    const updated = applyShapeProperties(RECT, { fillColor: "#0000ff" });
    expect((updated as RectangleShape).fillColor).toEqual([0, 0, 255]);
  });

  it("applies pattern enum", () => {
    const updated = applyShapeProperties(RECT, { pattern: "Dash" });
    expect((updated as RectangleShape).pattern).toBe("Dash");
  });

  it("applies radius", () => {
    const updated = applyShapeProperties(RECT, { radius: 5 });
    expect((updated as RectangleShape).radius).toBe(5);
  });

  it("leaves fields unchanged when value is absent", () => {
    const updated = applyShapeProperties(RECT, {});
    expect(updated).toMatchObject(RECT);
  });

  it("ignores malformed number values", () => {
    const base: RectangleShape = { ...RECT, radius: 3 };
    const updated = applyShapeProperties(base, { radius: "not-a-number" });
    expect((updated as RectangleShape).radius).toBe(3);
  });

  it("applies line color as Color tuple", () => {
    const line = {
      kind: "line" as const,
      points: [
        [0, 0],
        [10, 10],
      ] as [number, number][],
    };
    const updated = applyShapeProperties(line, { color: "#0080ff" });
    expect(
      (updated as typeof line & { color?: [number, number, number] }).color,
    ).toEqual([0, 128, 255]);
  });

  it("applies textString when it is a string", () => {
    const text = {
      kind: "text" as const,
      extent: [
        [-20, -10],
        [20, 10],
      ] as [[number, number], [number, number]],
      textString: "old",
    };
    const updated = applyShapeProperties(text, { textString: "new" });
    expect((updated as typeof text).textString).toBe("new");
  });

  it("does not overwrite textString with non-string values", () => {
    const text = {
      kind: "text" as const,
      extent: [
        [-20, -10],
        [20, 10],
      ] as [[number, number], [number, number]],
      textString: "keep",
    };
    const updated = applyShapeProperties(text, { textString: 42 });
    expect((updated as typeof text).textString).toBe("keep");
  });

  it("preserves shape kind and structural fields", () => {
    const updated = applyShapeProperties(RECT, { lineColor: "#ff0000" });
    expect(updated.kind).toBe("rectangle");
    expect((updated as RectangleShape).extent).toEqual(RECT.extent);
  });
});

// ── form ↔ applier field agreement ───────────────────────────────────────────

/**
 * `buildShapePropertiesForm` names the fields the modal submits, and
 * `applyShapeProperties` reads them back by name. A name only one side knows
 * makes the modal look like it works and the shape never change — an Apply that
 * writes the shape it was already given.
 */
describe("shape properties form round-trip", () => {
  const SHAPES: Shape[] = [
    {
      kind: "line",
      points: [
        [0, 0],
        [10, 10],
      ],
      color: [0, 0, 0],
    },
    {
      kind: "polygon",
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      lineColor: [0, 0, 0],
      fillColor: [255, 255, 255],
    },
    {
      kind: "rectangle",
      extent: [
        [0, 0],
        [10, 10],
      ],
      lineColor: [0, 0, 0],
      fillColor: [255, 255, 255],
    },
    {
      kind: "ellipse",
      extent: [
        [0, 0],
        [10, 10],
      ],
      lineColor: [0, 0, 0],
      fillColor: [255, 255, 255],
    },
    {
      kind: "text",
      extent: [
        [0, 0],
        [10, 10],
      ],
      textString: "hello",
      textColor: [0, 0, 0],
    },
    {
      kind: "bitmap",
      extent: [
        [0, 0],
        [10, 10],
      ],
      fileName: "a.png",
    },
  ];

  /** A value distinct from `field.value`, in the shape the modal would submit. */
  function otherValue(field: ParameterField): unknown {
    switch (field.kind) {
      case "boolean":
        return field.value !== true;
      case "number":
        return typeof field.value === "number" ? field.value + 7 : 7;
      case "enum": {
        const choices = field.enumChoices ?? [];
        const other = choices.find((c) => c !== field.value);
        return other ?? null;
      }
      case "color":
        // A colour field carries `null` when the shape leaves it unset, so the
        // substitute has to be a valid hex rather than a mutation of it.
        return field.value === "#123456" ? "#654321" : "#123456";
      default:
        return typeof field.value === "string" ? `${field.value}-x` : "changed";
    }
  }

  for (const shape of SHAPES) {
    it(`carries every ${shape.kind} field back onto the shape`, () => {
      const form = buildShapePropertiesForm(shape);
      expect(form.fields.length).toBeGreaterThan(0);

      for (const field of form.fields) {
        const next = otherValue(field);
        // An enum with a single choice has no other value to offer; anything
        // else answering null would be a field this test silently skips.
        if (next === null) {
          expect((field.enumChoices ?? []).length, field.name).toBeLessThan(2);
          continue;
        }
        if (next === field.value) continue;
        const edited = applyShapeProperties(shape, { [field.name]: next });
        expect(
          JSON.stringify(edited),
          `field "${field.name}" (${field.kind}) did not reach the shape`,
        ).not.toBe(JSON.stringify(shape));
      }
    });
  }
});
