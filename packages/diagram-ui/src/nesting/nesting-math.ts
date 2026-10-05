/**
 * Pure math behind semantic in-place nesting: how far a component's box has
 * opened at its current on-screen size, and how its class diagram fits into
 * the box.
 */

import { OVERLAY_BLUE } from "../base/overlay-mesh.js";
import type { Box } from "../base/placement-math.js";

/** On-screen box sizes (CSS px): fully open at and above `enterPx`, icon
 *  only at and below `exitPx`. */
export const NESTING_THRESHOLDS = {
  enterPx: 200,
  exitPx: 140,
} as const;

/** Look of the boundary drawn round an opened box. Widths are CSS px. */
export const NESTING_CHROME = {
  strokeWidthPx: 1.5,
  strokeColor: OVERLAY_BLUE,
  fillColor: OVERLAY_BLUE,
  fillOpacity: 0.04,
} as const;

/**
 * Open fraction in `[0, 1]` for a box `sizePx` wide on screen. A function of
 * size alone, with no hysteresis state, so scrolling back retraces the same
 * fade and no threshold can flicker.
 */
export function nestingProgress(sizePx: number): number {
  if (!Number.isFinite(sizePx)) return 0;
  const { enterPx, exitPx } = NESTING_THRESHOLDS;
  if (sizePx <= exitPx) return 0;
  if (sizePx >= enterPx) return 1;
  return (sizePx - exitPx) / (enterPx - exitPx);
}

/** Per-axis scale + translation mapping content space into box space. */
export interface LetterboxFit {
  scaleX: number;
  scaleY: number;
  x: number;
  y: number;
}

/**
 * Fits `content` inside `box` so that it reads unstretched and unmirrored
 * on screen, where `box` is itself drawn at the signed per-axis `boxScale`
 * of its placement: one on-screen scale on both axes, the tighter axis
 * decides, and the content centre lands on the box centre. A point `p` in
 * content space maps to `(p.x * scaleX + x, p.y * scaleY + y)` in box space.
 */
export function letterbox(
  content: Box,
  box: Box,
  boxScale: { x: number; y: number },
): LetterboxFit {
  const sx =
    content.width > 0
      ? Math.abs(box.width * boxScale.x) / content.width
      : Infinity;
  const sy =
    content.height > 0
      ? Math.abs(box.height * boxScale.y) / content.height
      : Infinity;
  const tight = Math.min(sx, sy);
  const onScreen = Number.isFinite(tight) ? tight : 1;
  const scaleX = onScreen / (boxScale.x || 1);
  const scaleY = onScreen / (boxScale.y || 1);
  return {
    scaleX,
    scaleY,
    x: box.cx - content.cx * scaleX,
    y: box.cy - content.cy * scaleY,
  };
}
