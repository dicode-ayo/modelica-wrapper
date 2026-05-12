import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { PanZoom } from "../src/scene/pan-zoom.js";
import type { ViewState } from "../src/scene/view-math.js";

/**
 * happy-dom's `WheelEvent` constructor silently drops `ctrlKey` /
 * `metaKey` from its init dict. Build the event normally, then patch
 * the modifier keys onto the instance — they're readonly via the
 * spec, but the JS prototype field is writable enough for tests.
 */
function wheelEvent(
  init: WheelEventInit & { ctrlKey?: boolean; metaKey?: boolean },
): WheelEvent {
  const e = new WheelEvent("wheel", init);
  if (init.ctrlKey !== undefined) {
    Object.defineProperty(e, "ctrlKey", { value: init.ctrlKey });
  }
  if (init.metaKey !== undefined) {
    Object.defineProperty(e, "metaKey", { value: init.metaKey });
  }
  return e;
}

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
  // ---- wheel: classification ----

  it("plain wheel pans (no zoom) — touchpad two-finger scroll", () => {
    canvas.dispatchEvent(
      wheelEvent({
        deltaX: 40,
        deltaY: 0,
        clientX: 400,
        clientY: 200,
      }),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]!.zoom).toBe(100);
    // Scroll-right (deltaX > 0) reveals content to the right →
    // camera target X increases.
    expect(captured[0]!.panX).toBeGreaterThan(0);
  });

  it("plain wheel deltaY pans vertically", () => {
    canvas.dispatchEvent(
      wheelEvent({
        deltaX: 0,
        deltaY: 40,
        clientX: 400,
        clientY: 200,
      }),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]!.zoom).toBe(100);
    // Scroll-down reveals content below → camera target Y decreases
    // (our +Y is up).
    expect(captured[0]!.panY).toBeLessThan(0);
  });

  it("ctrl + wheel up zooms in (shrinks visible region)", () => {
    canvas.dispatchEvent(
      wheelEvent({
        deltaY: -100,
        clientX: 400,
        clientY: 200,
        ctrlKey: true,
      }),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]!.zoom).toBeLessThan(100);
  });

  it("ctrl + wheel down zooms out (grows visible region)", () => {
    canvas.dispatchEvent(
      wheelEvent({
        deltaY: 100,
        clientX: 400,
        clientY: 200,
        ctrlKey: true,
      }),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]!.zoom).toBeGreaterThan(100);
  });

  it("meta + wheel zooms (macOS pinch convention)", () => {
    canvas.dispatchEvent(
      wheelEvent({
        deltaY: -100,
        clientX: 400,
        clientY: 200,
        metaKey: true,
      }),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]!.zoom).toBeLessThan(100);
  });

  it("small touchpad pinch deltas zoom by less than a full mouse notch", () => {
    canvas.dispatchEvent(
      wheelEvent({
        deltaY: -5,
        clientX: 400,
        clientY: 200,
        ctrlKey: true,
      }),
    );
    canvas.dispatchEvent(
      wheelEvent({
        deltaY: -100,
        clientX: 400,
        clientY: 200,
        ctrlKey: true,
      }),
    );
    expect(captured).toHaveLength(2);
    const smallStep = 100 / captured[0]!.zoom;
    const fullStep = captured[0]!.zoom / captured[1]!.zoom;
    expect(smallStep).toBeLessThan(fullStep);
  });

  // ---- pointer: classification ----

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

  it("right-button drag pans (button !== 0 is pan)", () => {
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        button: 2,
        clientX: 100,
        clientY: 100,
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
      new PointerEvent("pointerup", { pointerId: 1, button: 2 }),
    );
    expect(captured.length).toBeGreaterThan(0);
  });

  it("primary button drag does NOT pan (reserved for selection)", () => {
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
});
