import { describe, expect, it } from "vitest";

import { PolylineDrawing } from "../src/interaction/polyline-drawing.js";
import type { Point } from "@dicode/omc-client";

describe("PolylineDrawing", () => {
  it("is inactive before a gesture starts", () => {
    const d = new PolylineDrawing();
    expect(d.active).toBe(false);
    expect(d.drawKind).toBe(null);
    expect(d.vertexCount).toBe(0);
    expect(d.draftPoints()).toBe(null);
    expect(d.firstVertex()).toBe(null);
  });

  it("arms with a first vertex on start", () => {
    const d = new PolylineDrawing();
    d.start("line", [10, 20]);
    expect(d.active).toBe(true);
    expect(d.drawKind).toBe("line");
    expect(d.vertexCount).toBe(1);
    expect(d.firstVertex()).toEqual([10, 20]);
  });

  it("ignores cursor / vertex / undo when no gesture is active", () => {
    const d = new PolylineDrawing();
    d.moveCursor([1, 1]);
    d.addVertex([2, 2]);
    d.undoVertex();
    expect(d.active).toBe(false);
    expect(d.vertexCount).toBe(0);
  });

  it("appends a vertex per click and tracks the cursor", () => {
    const d = new PolylineDrawing();
    d.start("line", [0, 0]);
    d.addVertex([10, 0]);
    d.moveCursor([10, 10]);
    expect(d.vertexCount).toBe(2);
    expect(d.draftPoints()).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
  });

  it("ignores a click that repeats the previous vertex", () => {
    const d = new PolylineDrawing();
    d.start("polygon", [0, 0]);
    d.addVertex([10, 0]);
    d.addVertex([10, 0]);
    expect(d.vertexCount).toBe(2);
  });

  it("does not duplicate the last vertex in the draft when the cursor sits on it", () => {
    const d = new PolylineDrawing();
    d.start("line", [0, 0]);
    d.addVertex([10, 0]);
    // The cursor lands on the just-placed vertex (no move since the click).
    expect(d.draftPoints()).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  it("requires two vertices to finish a line, three for a polygon", () => {
    const line = new PolylineDrawing();
    line.start("line", [0, 0]);
    expect(line.canFinish()).toBe(false);
    line.addVertex([10, 0]);
    expect(line.canFinish()).toBe(true);

    const poly = new PolylineDrawing();
    poly.start("polygon", [0, 0]);
    poly.addVertex([10, 0]);
    expect(poly.canFinish()).toBe(false);
    poly.addVertex([10, 10]);
    expect(poly.canFinish()).toBe(true);
  });

  it("finishes into a shape carrying the distinct vertices and resets", () => {
    const d = new PolylineDrawing();
    d.start("polygon", [0, 0]);
    d.addVertex([10, 0]);
    d.addVertex([10, 10]);
    const result = d.finish();
    expect(result).toEqual({
      kind: "polygon",
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    });
    expect(d.active).toBe(false);
  });

  it("finish with too few vertices returns null and resets", () => {
    const d = new PolylineDrawing();
    d.start("line", [0, 0]);
    expect(d.finish()).toBe(null);
    expect(d.active).toBe(false);
  });

  it("undoVertex drops the last vertex, cancelling once none remain", () => {
    const d = new PolylineDrawing();
    d.start("line", [0, 0]);
    d.addVertex([10, 0]);
    d.undoVertex();
    expect(d.vertexCount).toBe(1);
    expect(d.active).toBe(true);
    d.undoVertex();
    expect(d.active).toBe(false);
  });

  it("the committed points are a copy — later edits don't mutate the result", () => {
    const d = new PolylineDrawing();
    d.start("line", [0, 0]);
    d.addVertex([10, 0]);
    const result = d.finish();
    d.start("line", [99, 99]);
    const points: Point[] = result?.points ?? [];
    expect(points).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });
});
