import type { Extent, Point } from "@dicode/omc-client";

import type { DiagramPoint } from "./gesture-mode.js";
import type { ExtentKind, PolyKind } from "./tools.js";

/**
 * Events a {@link ToolMode} emits as the user draws. Kept separate from the
 * press-drag `DragEvents` channel: a tool is an armed, sticky drawing mode,
 * not a transient gesture on an existing entity. The host turns these into
 * `draftLayout` previews and committed graphics.
 *
 *   - `drawShape` — extent primitive (rectangle / ellipse). `draft: true` on
 *     every move; `draft: false` on release to commit; `extent: null` on a
 *     degenerate (click, no drag) release so nothing is created.
 *   - `drawPoly` — poly primitive (line / polygon) across its multi-click
 *     life: `draft` on every vertex / cursor move, `commit` when finished,
 *     `cancel` when abandoned.
 */
export interface ToolEvents {
  drawShape: { kind: ExtentKind; extent: Extent | null; draft: boolean };
  drawPoly:
    | { phase: "draft"; kind: PolyKind; points: Point[] }
    | { phase: "commit"; kind: PolyKind; points: Point[] }
    | { phase: "cancel" };
}

export type ToolEmit = <K extends keyof ToolEvents>(
  type: K,
  detail: ToolEvents[K],
) => void;

/**
 * An armed drawing tool's input controller. Unlike a press-drag
 * `GestureMode` — which the router owns only between one `pointerdown` and
 * the matching `pointerup` — a `ToolMode` is *sticky*: it stays armed across
 * draws and, for multi-click tools, owns the keyboard. The router routes
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
