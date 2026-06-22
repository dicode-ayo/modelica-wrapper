import type { Shape } from "@dicode/omc-client";

import type { DiagramPoint } from "./gesture-mode.js";

/**
 * A draw step a {@link ToolMode} emits. The mode owns all shape
 * interpretation — snapping, degeneracy guards, the polygon-preview-as-line
 * choice — and emits a ready-to-apply `Shape`. The host only places it: a
 * `draft` previews via `draftLayout`, a `commit` persists it, a `cancel`
 * drops the preview without creating anything.
 */
export type ToolDraw =
  | { phase: "draft"; shape: Shape }
  | { phase: "commit"; shape: Shape }
  | { phase: "cancel" };

export type ToolEmit = (draw: ToolDraw) => void;

/**
 * An armed drawing tool's input controller: sticky (stays armed across draws)
 * and, for multi-click tools, the owner of the keyboard. The router routes
 * pointer / key / double-click to the active tool while a draw tool is armed.
 *
 * Two families implement it: {@link ExtentToolMode} (press-drag, one shape
 * per drag) and {@link MultiClickToolMode} (one vertex per click, finished by
 * double-click / Enter / closing the path).
 */
export interface ToolMode {
  /** Press-drag tools (extent) capture the pointer between press and release
   *  and only draw while a press is in flight; click tools (poly) don't. */
  readonly pressDrag: boolean;
  /** Whether a draw is currently in flight (drives the store mode + the
   *  host's hover suppression). */
  readonly active: boolean;
  /** Primary-button press at `point`. */
  press(point: DiagramPoint): void;
  /** Pointer moved to `point`. */
  move(point: DiagramPoint): void;
  /** Primary-button release at `point`. */
  release(point: DiagramPoint): void;
  /** Double-click: multi-click tools finish, press-drag tools ignore it. */
  finish(): void;
  /** A key while armed; returns true when consumed (Enter / Backspace /
   *  Escape for multi-click tools). */
  key(e: KeyboardEvent): boolean;
  /** Abandon any in-flight draw — the tool was switched or disarmed. */
  cancel(): void;
}
