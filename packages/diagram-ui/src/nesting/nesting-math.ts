import { OVERLAY_BLUE } from "../base/overlay-mesh.js";
import type { Box } from "../base/placement-math.js";

/** On-screen box sizes in CSS px: open at `enterPx`, icon at `exitPx`. */
export const NESTING_THRESHOLDS = {
  enterPx: 200,
  exitPx: 140,
} as const;

/** Frame round an opened box; widths in CSS px. */
export const NESTING_CHROME = {
  strokeWidthPx: 1.5,
  strokeColor: OVERLAY_BLUE,
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
