import type { DragController } from "../../src/interaction/drag-controller.js";
import type { InteractionManager } from "../../src/interaction/interaction-manager.js";

/**
 * Wire a listener-free controller to a canvas the way `ModeRouter` does
 * in production, so unit tests can keep driving it with dispatched
 * pointer events. The controllers no longer self-attach.
 */
export function wireDrag(canvas: HTMLCanvasElement, c: DragController): void {
  canvas.addEventListener("pointerdown", (e) => c.handlePointerDown(e));
  canvas.addEventListener("pointermove", (e) => c.handlePointerMove(e));
  canvas.addEventListener("pointerup", (e) => c.handlePointerUp(e));
  canvas.addEventListener("pointercancel", (e) => c.handlePointerUp(e));
}

export function wireInteraction(
  canvas: HTMLCanvasElement,
  m: InteractionManager,
): void {
  canvas.addEventListener("pointermove", (e) => m.handlePointerMove(e));
  canvas.addEventListener("pointerdown", (e) => m.handlePointerDown(e));
  canvas.addEventListener("pointerup", (e) => m.handlePointerUp(e));
  canvas.addEventListener("pointerleave", () => m.handlePointerLeave());
}
