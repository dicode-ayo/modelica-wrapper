/**
 * Positional accessors for the flattened `Icon`/`Diagram` annotation Value tree
 * that `getIconAnnotation`/`getDiagramAnnotation` return.
 *
 * OMC flattens the layer annotation into a single list:
 *   `[x1, y1, x2, y2, preserveAspectRatio, initialScale, gridX, gridY, {graphics…}]`
 * — the leading eight slots are the `coordinateSystem` fields (each `null` at
 * its default), the last is the graphics records. These accessors are the one
 * place that layout is named, so the write path and its tests don't each
 * re-derive `items.at(8)` and the extent slice.
 */

import type { Value } from "../../parse.js";

const GRAPHICS_INDEX = 8;

/**
 * The `coordinateSystem` fields read positionally from the flattened Value
 * tree, each `null` when at its OMC default. Distinct from `CoordinateSystem`
 * (validated ModelInstance JSON): tuple-typed and null-defaulted for the write
 * path's re-emit.
 */
export interface CoordinateSystemFields {
  extent: [number, number, number, number] | null;
  preserveAspectRatio: boolean | null;
  initialScale: number | null;
  grid: [number, number] | null;
}

function asNumber(v: Value | undefined): number | null {
  return v !== undefined && (v.kind === "int" || v.kind === "float")
    ? v.value
    : null;
}

function asBool(v: Value | undefined): boolean | null {
  return v?.kind === "bool" ? v.value : null;
}

function listItems(annotation: Value): Value[] {
  return annotation.kind === "list" ? annotation.items : [];
}

/** The graphic records (`Rectangle`/`Line`/…) of a layer annotation. */
export function annotationGraphics(annotation: Value): Value[] {
  const list = listItems(annotation).at(GRAPHICS_INDEX);
  return list && list.kind === "list" ? list.items : [];
}

/** The `coordinateSystem` fields of a layer annotation. */
export function annotationCoordinateSystem(
  annotation: Value,
): CoordinateSystemFields {
  const items = listItems(annotation);
  const x1 = asNumber(items[0]);
  const y1 = asNumber(items[1]);
  const x2 = asNumber(items[2]);
  const y2 = asNumber(items[3]);
  const extent: [number, number, number, number] | null =
    x1 !== null && y1 !== null && x2 !== null && y2 !== null
      ? [x1, y1, x2, y2]
      : null;

  const gridX = asNumber(items[6]);
  const gridY = asNumber(items[7]);
  const grid: [number, number] | null =
    gridX !== null && gridY !== null ? [gridX, gridY] : null;

  return {
    extent,
    preserveAspectRatio: asBool(items[4]),
    initialScale: asNumber(items[5]),
    grid,
  };
}
