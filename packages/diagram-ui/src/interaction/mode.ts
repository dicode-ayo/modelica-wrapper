import type { Scene, TransformNode } from "@babylonjs/core";

import {
  InteractionManager,
  type EmitFn,
  type PickerFn,
} from "./interaction-manager.js";
import { entityKeyForNode, type EntityKey } from "./node-keys.js";
import {
  capturePointer,
  releasePointer,
  MOVE_KINDS,
  type ClientToDiagram,
  type CompatCheck,
  type ConnectorPosition,
  type DragEmit,
  type GestureMode,
  type Picker,
  type SelectionProvider,
} from "./gesture-mode.js";
import { SelectMode } from "./select-mode.js";
import { DragMode } from "./drag-mode.js";
import { ConnectMode } from "./connect-mode.js";
import { ExtentDrawMode } from "./extent-draw-mode.js";
import type { InteractionStateStore } from "./interaction-state.js";
import type { ExtentKind, PolyKind } from "./tools.js";

/**
 * Multi-click poly draw (Line / Polygon). The router feeds it primary
 * clicks (`press`) and cursor moves (`hover`) while a poly tool is armed;
 * the host owns the gesture state and decides start / append / finish.
 * Unlike the press-drag `GestureMode`s this spans many clicks, so it lives
 * outside the active-gesture machinery.
 */
export interface PolyDrawController {
  press(point: { x: number; y: number }): void;
  hover(point: { x: number; y: number }): void;
}

export interface ModeRouterDeps {
  canvas: HTMLCanvasElement;
  picker: PickerFn;
  clientToDiagram: ClientToDiagram;
  getSelectionKeys: SelectionProvider;
  onInteraction: EmitFn;
  onDrag: DragEmit;
  store: InteractionStateStore;
  /** Scene + parent the gesture modes draw their transient meshes into. */
  scene: Scene;
  overlayParent: TransformNode;
  /** Diagram-space position of a connector (for the routing wire). */
  connectorPosition: ConnectorPosition;
  /** Local compatibility check between two connector keys. */
  evaluateCompat: CompatCheck;
  /** The extent shape the armed draw tool draws, or `null` for any non-extent
   *  tool. A non-null value routes a press to the extent draw mode. */
  getExtentKind: () => ExtentKind | null;
  /** The poly shape the armed draw tool draws, or `null` otherwise. A non-null
   *  value routes clicks + cursor moves to the multi-click `polyDraw`. */
  getPolyKind: () => PolyKind | null;
  polyDraw: PolyDrawController;
}

/**
 * The interaction state manager. Owns the one set of canvas pointer
 * listeners for the diagram's lifetime. Hover, click-select and the
 * context menu run always (via the `InteractionManager`). A `pointerdown`
 * hit-tests and transitions `idle → {select | drag | connect}` — the
 * matching gesture mode owns the press-drag until `pointerup` returns it
 * to `idle`. Switching is a field swap, never `add/removeEventListener`.
 */
export class ModeRouter {
  private readonly canvas: HTMLCanvasElement;
  private readonly picker: Picker;
  private readonly clientToDiagram: ClientToDiagram;
  private readonly getSelectionKeys: SelectionProvider;
  private readonly store: InteractionStateStore;
  private readonly interactionManager: InteractionManager;
  private readonly selectMode: GestureMode;
  private readonly dragMode: GestureMode;
  private readonly connectMode: GestureMode;
  private readonly drawMode: GestureMode;
  private readonly getExtentKind: () => ExtentKind | null;
  private readonly getPolyKind: () => PolyKind | null;
  private readonly polyDraw: PolyDrawController;
  private active: GestureMode | null = null;
  private pointerId = -1;

  constructor(deps: ModeRouterDeps) {
    this.canvas = deps.canvas;
    this.picker = deps.picker;
    this.clientToDiagram = deps.clientToDiagram;
    this.getSelectionKeys = deps.getSelectionKeys;
    this.store = deps.store;
    this.interactionManager = new InteractionManager(
      deps.picker,
      deps.onInteraction,
    );
    this.selectMode = new SelectMode(
      deps.onDrag,
      deps.scene,
      deps.overlayParent,
    );
    this.dragMode = new DragMode(deps.onDrag);
    this.connectMode = new ConnectMode(
      deps.picker,
      deps.onDrag,
      deps.scene,
      deps.overlayParent,
      deps.connectorPosition,
      deps.evaluateCompat,
    );
    this.getExtentKind = deps.getExtentKind;
    this.getPolyKind = deps.getPolyKind;
    this.polyDraw = deps.polyDraw;
    this.drawMode = new ExtentDrawMode(deps.onDrag, deps.getExtentKind);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
  }

  /**
   * True while a press-drag gesture is in flight. Flips on `pointerdown`,
   * earlier than the interaction-store gesture state — the host gates its
   * hover-suppression on this, not on `state.kind`.
   */
  isGestureActive(): boolean {
    return this.active !== null;
  }

  destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.active?.cancel?.();
    this.active = null;
  }

  private modeFor(entity: EntityKey | null): GestureMode {
    // An armed extent draw tool owns every press — you draw over components too.
    if (this.getExtentKind() !== null) {
      return this.drawMode;
    }
    if (entity?.kind === "port" || entity?.kind === "connector") {
      return this.connectMode;
    }
    if (
      entity &&
      (entity.kind === "rotate-handle" ||
        entity.kind === "handle" ||
        entity.kind === "edge" ||
        MOVE_KINDS.has(entity.kind))
    ) {
      return this.dragMode;
    }
    return this.selectMode;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    // A poly tool owns clicks: each primary press places a vertex. It
    // bypasses select / drag and the InteractionManager so clicking over a
    // component draws rather than selecting it. No pointer capture — the
    // gesture is click-based, not a press-drag.
    if (this.getPolyKind() !== null) {
      if (e.button === 0 && !e.shiftKey) {
        const point = this.clientToDiagram(e.clientX, e.clientY);
        if (point) {
          this.polyDraw.press(point);
        }
      }
      return;
    }
    // Hover / click-select / context-menu run regardless of mode.
    this.interactionManager.handlePointerDown(e);
    if (e.button !== 0 || e.shiftKey) {
      return; // shift+primary is the pan modifier (see PanZoom)
    }
    const node = this.picker(e.clientX, e.clientY);
    const entity = node ? entityKeyForNode(node) : null;
    const point = this.clientToDiagram(e.clientX, e.clientY);
    if (!point) {
      return;
    }
    const mode = this.modeFor(entity);
    const started = mode.begin({
      node,
      entity,
      point,
      shiftKey: e.shiftKey,
      getSelectionKeys: this.getSelectionKeys,
    });
    if (started) {
      this.active = mode;
      this.pointerId = e.pointerId;
      capturePointer(this.canvas, e.pointerId);
      this.store.next({ mode: mode.id });
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    // While a poly tool is armed the cursor drives the rubber-band segment;
    // suppress hover so components don't light up mid-draw.
    if (this.getPolyKind() !== null) {
      const point = this.clientToDiagram(e.clientX, e.clientY);
      if (point) {
        this.polyDraw.hover(point);
      }
      return;
    }
    this.interactionManager.handlePointerMove(e);
    if (!this.active || e.pointerId !== this.pointerId) {
      return;
    }
    const point = this.clientToDiagram(e.clientX, e.clientY);
    if (!point) {
      return;
    }
    this.active.update(point, e);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    // A poly draw owns nothing on release — it commits on click / dblclick
    // / keyboard, never on pointerup. Skip the context-menu path too so a
    // right-release doesn't pop a menu over an in-progress draw.
    if (this.getPolyKind() !== null) {
      return;
    }
    this.interactionManager.handlePointerUp(e);
    if (!this.active || e.pointerId !== this.pointerId) {
      return;
    }
    const point = this.clientToDiagram(e.clientX, e.clientY) ?? { x: 0, y: 0 };
    const mode = this.active;
    this.active = null;
    this.pointerId = -1;
    releasePointer(this.canvas, e.pointerId);
    mode.commit(point, e);
    this.store.next({ mode: "idle" });
  };

  private readonly onPointerLeave = (): void => {
    this.interactionManager.handlePointerLeave();
  };
}
