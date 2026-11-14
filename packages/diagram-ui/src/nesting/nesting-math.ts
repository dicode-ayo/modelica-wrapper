import { OVERLAY_BLUE } from "../base/overlay-mesh.js";
import type { CoordinateSystem, Point } from "@dicode/omc-client";

import { coordSystemSize, type Box } from "../base/placement-math.js";

/**
 * On-screen box sizes in CSS px: open at `enterPx`, icon at `exitPx`. Above
 * `prefetchPx` the box's diagram is fetched while it still shows the icon, so
 * a box growing into the band finds it ready.
 */
export const NESTING_THRESHOLDS = {
  enterPx: 200,
  exitPx: 140,
  prefetchPx: 100,
} as const;

/** Fade-in for a diagram that lands after its box has already started to open. */
export const NESTING_LATE_FADE_MS = 200;

/** Frame around an opened box; widths in CSS px. */
export const NESTING_CHROME = {
  strokeWidthPx: 1.5,
  strokeColor: OVERLAY_BLUE,
  strokeAlpha: 0.35,
  fillColor: OVERLAY_BLUE,
  fillOpacity: 0.04,
} as const;

/** Open fraction in `[0, 1]`. Stateless, so reversing the zoom retraces the fade. */
export function nestingProgress(sizePx: number): number {
  if (!Number.isFinite(sizePx)) return 0;
  const { enterPx, exitPx } = NESTING_THRESHOLDS;
  if (sizePx <= exitPx) return 0;
  if (sizePx >= enterPx) return 1;
  return (sizePx - exitPx) / (enterPx - exitPx);
}

/** Whether a box this size wants its diagram at hand, open or about to be. */
export function nestingPrefetches(sizePx: number): boolean {
  return Number.isFinite(sizePx) && sizePx > NESTING_THRESHOLDS.prefetchPx;
}

/** The fraction of `NESTING_LATE_FADE_MS` elapsed, clamped to `[0, 1]`. */
export function lateFadeProgress(elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0;
  return Math.min(1, elapsedMs / NESTING_LATE_FADE_MS);
}

export interface LetterboxFit {
  scaleX: number;
  scaleY: number;
  x: number;
  y: number;
}

/**
 * Fits `content` into `box`, which is drawn at the signed `boxScale`, so it
 * reads centred, unstretched and unmirrored on screen.
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

export function nestedFit(
  content: CoordinateSystem | undefined,
  box: Box,
  boxScale: { x: number; y: number },
): LetterboxFit {
  return letterbox(coordSystemSize(content), box, boxScale);
}

/** Where `point` of the fitted content lands in the box's coordinates. */
export function fitPoint(fit: LetterboxFit, [x, y]: Point): Point {
  return [fit.x + x * fit.scaleX, fit.y + y * fit.scaleY];
}
