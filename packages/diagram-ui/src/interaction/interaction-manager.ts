import type { Node, Scene } from "@babylonjs/core";

import { entityKeyForNode, formatKey } from "./node-keys.js";

/**
 * Picker function: given client (viewport) pixel coords, return the
 * Babylon node under that pixel — or `null` for misses. The interaction
 * manager doesn't talk to Babylon directly; the picker is injected so
 * tests can stub it with deterministic results (NullEngine can't
 * raycast against actual geometry).
 */
export type PickerFn = (clientX: number, clientY: number) => Node | null;

/** Builds a {@link PickerFn} for a scene/canvas pair. `defaultPicker` is
 *  the production implementation; tests inject a deterministic one. */
export type PickerFactory = (
  scene: Scene,
  canvas: HTMLCanvasElement,
) => PickerFn;

export interface InteractionEvents {
  /** Fires whenever the entity under the pointer changes (incl. to `null`). */
  hover: { key: string | null };
  /** Primary-button down on an entity. `addToSelection` mirrors shift. */
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

/**
 * Translates pointer events (fed by the interaction router) into typed
 * interaction events keyed by entity. Three observable events are
 * produced — `hover`, `select`, `contextMenu`, plus `doubleClick` when
 * the same key receives two `select`-eligible primary clicks within
 * the `doubleClickMs` window.
 *
 * Modifiers:
 *   - shift + primary  → `select` with `addToSelection: true`
 *   - secondary button → `contextMenu`
 *   - middle button    → swallowed (PanZoom owns it)
 */
export class InteractionManager {
  private readonly picker: PickerFn;
  private readonly emit: EmitFn;
  private readonly doubleClickMs: number;
  private hoverKey: string | null = null;
  private lastSelectKey: string | null = null;
  private lastSelectAt = 0;

  constructor(
    picker: PickerFn,
    emit: EmitFn,
    options: InteractionManagerOptions = {},
  ) {
    this.picker = picker;
    this.emit = emit;
    this.doubleClickMs = options.doubleClickMs ?? DEFAULT_DOUBLE_CLICK_MS;
  }

  handlePointerMove(e: PointerEvent): void {
    const key = this.pickKey(e.clientX, e.clientY);
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      this.emit("hover", { key });
    }
  }

  handlePointerLeave(): void {
    if (this.hoverKey !== null) {
      this.hoverKey = null;
      this.emit("hover", { key: null });
    }
  }

  handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0 || (e.shiftKey && this.isPanModifier(e))) {
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

    this.emit("select", { key, addToSelection: e.shiftKey });
    if (isDouble) {
      this.emit("doubleClick", { key });
    }
  }

  handlePointerUp(e: PointerEvent): void {
    if (e.button !== 2) {
      return;
    }
    const key = this.pickKey(e.clientX, e.clientY);
    this.emit("contextMenu", {
      key,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }

  private isPanModifier(e: PointerEvent): boolean {
    // Shift+primary is reserved for pan (see PanZoom). Don't shadow it.
    return e.button === 0 && e.shiftKey;
  }

  private pickKey(clientX: number, clientY: number): string | null {
    const node = this.picker(clientX, clientY);
    let entity = entityKeyForNode(node);
    // Selection handles (resize corners + rotate disc) belong to
    // `DragMode`. They are not selectable entities, so picking one must
    // not emit a `select` — otherwise the handle's own key replaces the
    // component in the selection and the shape deselects out from under
    // the gesture, taking its handles with it.
    if (entity?.kind === "handle" || entity?.kind === "rotate-handle") {
      return null;
    }
    // A `port` indicator is a child of its connector's TransformNode.
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
 * Builds the default picker bound to a Babylon Scene + canvas. The
 * scene must already be mounted. Filters out grid / axis lines via
 * `isPickable` settings (`<om-grid-axis>` keeps those off).
 */
export function defaultPicker(
  scene: Scene,
  canvas: HTMLCanvasElement,
): PickerFn {
  return (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const info = scene.pick(x, y);
    return info?.pickedMesh ?? null;
  };
}
