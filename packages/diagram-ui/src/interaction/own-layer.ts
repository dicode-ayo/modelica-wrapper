import type { DiagramLayout, Shape } from "@dicode/omc-client";

/**
 * The host class's OWN graphics layer (`from === className`) of the current
 * view, and the primitives that read and replace it. Only that layer is
 * editable — inherited ancestor layers render but never change — and a
 * `shape:<kind>:<index>` key addresses a shape by its position in it.
 */

/** Line / Polygon carry `points`; the other primitives carry an `extent`. */
export function isPolyShape(
  s: Shape,
): s is Extract<Shape, { kind: "line" | "polygon" }> {
  return s.kind === "line" || s.kind === "polygon";
}

/** The host's own editable layer, or `null` when it has no own graphics. */
export function ownLayer(layout: DiagramLayout): {
  field: "iconLayers" | "diagramLayers";
  index: number;
  shapes: Shape[];
} | null {
  const field = layout.kind === "icon" ? "iconLayers" : "diagramLayers";
  const layers = layout[field];
  const index = layers.findIndex((l) => l.from === layout.className);
  const own = index < 0 ? undefined : layers[index];
  return own ? { field, index, shapes: own.shapes } : null;
}

export function replaceOwnShapes(
  layout: DiagramLayout,
  field: "iconLayers" | "diagramLayers",
  layerIndex: number,
  shapes: Shape[],
): DiagramLayout {
  const layers = layout[field].map((l, i) =>
    i === layerIndex ? { ...l, shapes } : l,
  );
  return { ...layout, [field]: layers };
}

/**
 * Replaces each own-layer shape in `indices` via `fn`. A `fn` returning
 * `null` (or the same reference) leaves that shape untouched; the whole
 * call returns the same `layout` reference when nothing changed.
 */
export function updateOwnShapes(
  layout: DiagramLayout,
  indices: ReadonlySet<number>,
  fn: (shape: Shape) => Shape | null,
): DiagramLayout {
  if (indices.size === 0) {
    return layout;
  }
  const own = ownLayer(layout);
  if (!own) {
    return layout;
  }
  let mutated = false;
  const shapes = own.shapes.map((s, i) => {
    if (!indices.has(i)) {
      return s;
    }
    const next = fn(s);
    if (next && next !== s) {
      mutated = true;
      return next;
    }
    return s;
  });
  return mutated
    ? replaceOwnShapes(layout, own.field, own.index, shapes)
    : layout;
}
