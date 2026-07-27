import type { Container } from "pixi.js";

import type { SceneContext } from "../scene/scene-context.js";
import type { SelectionProvider } from "./gesture-mode.js";
import { entityKeyForNode, formatKey } from "./node-keys.js";

/**
 * Picker function: given client (viewport) pixel coords, return the
 * topmost interactive container under that pixel — or `null` for misses.
 * The interaction manager doesn't talk to the renderer directly; the
 * picker is injected so tests can stub it with deterministic results
 * (a renderer-less scene graph can't hit-test against laid-out geometry).
 */
export type PickerFn = (clientX: number, clientY: number) => Container | null;

/** Builds a {@link PickerFn} for a scene/canvas pair. `defaultPicker` is
 *  the production implementation; tests inject a deterministic one. */
export type PickerFactory = (
  ctx: SceneContext,
  canvas: HTMLCanvasElement,
) => PickerFn;

export interface InteractionEvents {
  /** Fires whenever the entity under the pointer changes (incl. to `null`). */
  hover: { key: string | null };
  /** Primary-button down on an entity. `addToSelection` mirrors Ctrl/Cmd. */
  select: { key: string; addToSelection: boolean };
  /** Two primary-button presses within the double-click window on the same key. */
  doubleClick: { key: string };
  /** Right-button up on an entity. */
  contextMenu: { key: string | null; clientX: number; clientY: number };
}

export type EmitFn = <K extends keyof InteractionEvents>(
  type: K,
  detail: InteractionEvents[K],
) => void;

export interface InteractionManagerOptions {
  doubleClickMs?: number;
}

const DEFAULT_DOUBLE_CLICK_MS = 350;

/** Pointer travel that makes a press a drag rather than a click. */
const DRAG_SLOP_PX = 3;

/**
 * A press on a member of a multi-selection, awaiting its release. Only one is
 * ever held: `pointerId` is a staleness guard so a release from an unrelated
 * pointer can't claim it, not multi-pointer support. A second pointer pressing
 * another member supersedes the first, whose narrowing is then dropped.
 */
interface PendingSelect {
  key: string;
  pointerId: number;
  clientX: number;
  clientY: number;
}

/**
 * Translates pointer events (fed by the interaction router) into typed
 * interaction events keyed by entity. Three observable events are
 * produced — `hover`, `select`, `contextMenu`, plus `doubleClick` when
 * the same key receives two `select`-eligible primary clicks within
 * the `doubleClickMs` window.
 *
 * Modifiers:
 *   - ctrl/cmd + primary → `select` with `addToSelection: true`
 *   - shift + primary    → swallowed (PanZoom owns it)
 *   - secondary button   → `contextMenu`
 *   - middle button      → swallowed (PanZoom owns it)
 *
 * An unmodified press on a member of a multi-selection defers its `select`
 * to the release, and drops it entirely once the pointer travels
 * {@link DRAG_SLOP_PX}. `DragMode.begin` reads the selection during the same
 * `pointerdown`, so narrowing there would leave it one key to carry and no
 * group could ever be dragged.
 */
export class InteractionManager {
  private readonly picker: PickerFn;
  private readonly emit: EmitFn;
  private readonly doubleClickMs: number;
  private readonly getSelectionKeys: SelectionProvider;
  private hoverKey: string | null = null;
  private lastSelectKey: string | null = null;
  private lastSelectAt = 0;
  private pendingSelect: PendingSelect | null = null;

  constructor(
    picker: PickerFn,
    emit: EmitFn,
    getSelectionKeys: SelectionProvider,
    options: InteractionManagerOptions = {},
  ) {
    this.picker = picker;
    this.emit = emit;
    this.getSelectionKeys = getSelectionKeys;
    this.doubleClickMs = options.doubleClickMs ?? DEFAULT_DOUBLE_CLICK_MS;
  }

  handlePointerMove(e: PointerEvent): void {
    this.dropPendingSelectOnDrag(e);
    const key = this.hoverKeyAt(e.clientX, e.clientY);
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      this.emit("hover", { key });
    }
  }

  /**
   * Hover resolution: like {@link pickKey}, but a vertex dot resolves to its
   * owner shape instead of `null`. The dots are revealed *by* that hover, so
   * collapsing to `null` the moment the pointer reaches one would make them
   * flicker out from under the cursor. (Select / context-menu still use
   * `pickKey`, where a handle must stay non-selectable.)
   */
  private hoverKeyAt(clientX: number, clientY: number): string | null {
    const node = this.picker(clientX, clientY);
    const entity = entityKeyForNode(node);
    if (entity?.kind === "vertex-handle" && node) {
      const owner = entityKeyForNode(node.parent ?? null);
      return owner ? formatKey(owner.kind, owner.nodeId) : null;
    }
    return this.pickKey(clientX, clientY);
  }

  handlePointerLeave(): void {
    if (this.hoverKey !== null) {
      this.hoverKey = null;
      this.emit("hover", { key: null });
    }
  }

  handlePointerDown(e: PointerEvent): void {
    // A new press supersedes any pending one. Several paths below return
    // without ever reaching a release — an armed draw tool swallows the
    // `pointerup` entirely — and a survivor would narrow the selection under
    // whatever gesture came next.
    this.pendingSelect = null;
    if (this.isPanModifier(e)) {
      return; // pan modifier — PanZoom owns it
    }
    if (e.button !== 0) {
      return;
    }
    const key = this.pickKey(e.clientX, e.clientY);
    if (key === null) {
      return;
    }
    const now = performance.now();
    const isDouble =
      this.lastSelectKey === key &&
      now - this.lastSelectAt < this.doubleClickMs;
    this.lastSelectKey = key;
    this.lastSelectAt = now;

    const addToSelection = e.ctrlKey || e.metaKey;
    // A second press within the window must keep emitting on the press, or
    // the deferral would swallow the `doubleClick` that rides with it.
    if (!addToSelection && !isDouble && this.isInMultiSelection(key)) {
      this.pendingSelect = {
        key,
        pointerId: e.pointerId,
        clientX: e.clientX,
        clientY: e.clientY,
      };
      return;
    }

    this.emit("select", { key, addToSelection });
    if (isDouble) {
      this.emit("doubleClick", { key });
    }
  }

  handlePointerUp(e: PointerEvent): void {
    if (e.button === 2) {
      // The menu opens against the whole selection, so a deferred narrowing
      // must not land on top of it once the primary button comes up.
      this.pendingSelect = null;
      const key = this.pickKey(e.clientX, e.clientY);
      this.emit("contextMenu", {
        key,
        clientX: e.clientX,
        clientY: e.clientY,
      });
      return;
    }
    if (e.button !== 0) {
      return;
    }
    const pending = this.takePendingSelect(e.pointerId);
    if (pending !== null) {
      this.emit("select", { key: pending.key, addToSelection: false });
    }
  }

  /** A cancelled pointer is not a click — the deferred narrowing is dropped. */
  handlePointerCancel(e: PointerEvent): void {
    this.takePendingSelect(e.pointerId);
  }

  private isInMultiSelection(key: string): boolean {
    const selection = this.getSelectionKeys();
    return selection.length > 1 && selection.includes(key);
  }

  private takePendingSelect(pointerId: number): PendingSelect | null {
    const pending = this.pendingSelect;
    if (pending === null || pending.pointerId !== pointerId) {
      return null;
    }
    this.pendingSelect = null;
    return pending;
  }

  private dropPendingSelectOnDrag(e: PointerEvent): void {
    const pending = this.pendingSelect;
    if (pending === null || pending.pointerId !== e.pointerId) {
      return;
    }
    const dx = e.clientX - pending.clientX;
    const dy = e.clientY - pending.clientY;
    if (dx * dx + dy * dy > DRAG_SLOP_PX * DRAG_SLOP_PX) {
      this.pendingSelect = null;
    }
  }

  /**
   * Shift+primary is reserved for pan (see PanZoom), which is why additive
   * selection is Ctrl/Cmd+click rather than the usual Shift+click.
   */
  private isPanModifier(e: PointerEvent): boolean {
    return e.button === 0 && e.shiftKey;
  }

  private pickKey(clientX: number, clientY: number): string | null {
    const node = this.picker(clientX, clientY);
    let entity = entityKeyForNode(node);
    // Selection handles (resize corners, rotate disc, vertex dots) belong
    // to `DragMode`. They are not selectable entities, so picking one must
    // not emit a `select` — otherwise the handle's own key replaces the
    // component in the selection and the shape deselects out from under
    // the gesture, taking its handles with it.
    if (
      entity?.kind === "handle" ||
      entity?.kind === "rotate-handle" ||
      entity?.kind === "vertex-handle"
    ) {
      return null;
    }
    // A `port` indicator is a child of its connector's container.
    // Once the indicator becomes visible (it lights up on hover), the
    // next pointermove can pick it instead of the connector behind
    // it — without this step the hover key would flip
    // connector ↔ port every few pixels, and `refreshPortIndicators`
    // would oscillate the indicator on/off. Resolving up to the
    // owning connector keeps the hover state stable while the user's
    // pointer stays over the entity. `ConnectMode` keeps its own walk
    // and still sees `kind: "port"` for the click-to-start-connection
    // gesture.
    if (entity?.kind === "port" && node) {
      entity = entityKeyForNode(node.parent ?? null);
    }
    return entity ? formatKey(entity.kind, entity.nodeId) : null;
  }
}

/**
 * Builds the default picker bound to a {@link SceneContext} + canvas. The
 * scene must already be mounted. Converts client coords to canvas-local
 * (stage) pixels and delegates to `ctx.pick`, which returns the topmost
 * interactive container (decorative subtrees opt out via `eventMode`).
 */
export function defaultPicker(
  ctx: SceneContext,
  canvas: HTMLCanvasElement,
): PickerFn {
  return (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    return ctx.pick(clientX - rect.left, clientY - rect.top);
  };
}
