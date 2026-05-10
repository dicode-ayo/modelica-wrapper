import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { PanZoom } from "../src/scene/pan-zoom.js";
import type { ViewState } from "../src/scene/view-math.js";

function makeCanvas(width = 800, height = 400): HTMLCanvasElement {
  const c = document.createElement("canvas");
  document.body.appendChild(c);
  // happy-dom returns 0×0 bounding rects by default; override.
  c.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
  return c;
}

let canvas: HTMLCanvasElement;
let view: ViewState;
let captured: ViewState[];
let panZoom: PanZoom;

beforeEach(() => {
  canvas = makeCanvas();
  view = { zoom: 100, panX: 0, panY: 0 };
  captured = [];
  panZoom = new PanZoom(
    canvas,
    () => view,
    (next) => {
      view = next;
      captured.push({ ...next });
    },
  );
});

afterEach(() => {
  panZoom.destroy();
  canvas.remove();
});

describe("PanZoom", () => {
  it("zoom-in on wheel up shrinks the visible region", () => {
    canvas.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, clientX: 400, clientY: 200 }),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]!.zoom).toBeLessThan(100);
  });

  it("zoom-out on wheel down grows the visible region", () => {
    canvas.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, clientX: 400, clientY: 200 }),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]!.zoom).toBeGreaterThan(100);
  });

  it("middle-mouse drag pans", () => {
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        button: 1,
        clientX: 100,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 180,
        clientY: 120,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 1,
        button: 1,
        clientX: 180,
        clientY: 120,
      }),
    );
    expect(captured.length).toBeGreaterThan(0);
    const final = captured[captured.length - 1]!;
    expect(final.panX).not.toBe(0);
    expect(final.panY).not.toBe(0);
  });

  it("primary button without shift does not pan", () => {
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        button: 0,
        clientX: 100,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 180,
        clientY: 120,
      }),
    );
    expect(captured).toHaveLength(0);
  });

  it("shift + primary drag does pan", () => {
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        button: 0,
        clientX: 100,
        clientY: 100,
        shiftKey: true,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 150,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1, button: 0 }),
    );
    expect(captured.length).toBeGreaterThan(0);
  });
});
