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
import { ExtentToolMode } from "./extent-tool-mode.js";
import { MultiClickToolMode } from "./multi-click-tool-mode.js";
import type { ToolEmit, ToolMode } from "./tool-mode.js";
import type { InteractionStateStore } from "./interaction-state.js";
import type { SnapGrid } from "./snap-math.js";
import { extentKindOf, polyKindOf, type ToolId } from "./tools.js";

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
  /** The armed tool. `select` routes presses to the gesture modes; a draw
   *  tool routes all input to the matching {@link ToolMode}. */
  getActiveTool: () => ToolId;
  /** Active snap grid, for the multi-click tool's vertex snapping. */
  getSnapGrid: () => SnapGrid;
  /** Sink for a tool mode's draw events. */
  onTool: ToolEmit;
}

/**
 * The interaction state manager. Owns the one set of canvas pointer
 * listeners for the diagram's lifetime. Hover, click-select and the
 * context menu run always (via the `InteractionManager`).
 *
 * Two routing families:
 *   - With `select` armed, a `pointerdown` hit-tests and transitions
 *     `idle → {select | drag | connect}` — the matching `GestureMode` owns
 *     the press-drag until `pointerup` returns it to `idle`.
 *   - With a draw tool armed, all input (pointer, key via `handleKey`,
 *     double-click via `handleDoubleClick`) routes to the matching
 *     {@link ToolMode}, under store mode `draw`.
 *
 * Switching is a field swap, never `add/removeEventListener`.
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
  private readonly extentTool: ToolMode;
  private readonly polyTool: ToolMode;
  private readonly getActiveTool: () => ToolId;
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
    this.getActiveTool = deps.getActiveTool;
    this.extentTool = new ExtentToolMode(deps.onTool, () =>
      extentKindOf(deps.getActiveTool()),
    );
    this.polyTool = new MultiClickToolMode(
      deps.onTool,
      () => polyKindOf(deps.getActiveTool()),
      deps.getSnapGrid,
    );
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
  }

  /**
   * True while a gesture or tool draw is in flight. Flips on `pointerdown`,
   * earlier than the interaction-store gesture state — the host gates its
   * hover-suppression on this, not on `state.kind`.
   */
  isGestureActive(): boolean {
    return this.active !== null || (this.activeToolMode()?.active ?? false);
  }

  /** Forward a key to the armed tool; returns true when it consumed it. */
  handleKey(e: KeyboardEvent): boolean {
    const tool = this.activeToolMode();
    if (!tool) {
      return false;
    }
    const consumed = tool.key(e);
    if (consumed) {
      this.syncToolMode(tool);
    }
    return consumed;
  }

  /** Forward a double-click to the armed tool; returns true when a tool is
   *  armed (so the host skips its own empty-canvas double-click handling). */
  handleDoubleClick(): boolean {
    const tool = this.activeToolMode();
    if (!tool) {
      return false;
    }
    tool.finish();
    this.syncToolMode(tool);
    return true;
  }

  /** Abandon any in-flight draw on the armed tool (e.g. the tool is about to
   *  be switched). A no-op when nothing is in flight. */
  cancelActiveTool(): void {
    const tool = this.activeToolMode();
    if (tool) {
      tool.cancel();
      this.syncToolMode(tool);
    }
  }

  destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.active?.cancel?.();
    this.active = null;
    this.extentTool.cancel();
    this.polyTool.cancel();
  }

  /** The tool mode for the armed tool, or `null` for `select`. */
  private activeToolMode(): ToolMode | null {
    const tool = this.getActiveTool();
    if (extentKindOf(tool)) {
      return this.extentTool;
    }
    if (polyKindOf(tool)) {
      return this.polyTool;
    }
    return null;
  }

  private syncToolMode(tool: ToolMode): void {
    this.store.next({ mode: tool.active ? "draw" : "idle" });
  }

  private modeFor(entity: EntityKey | null): GestureMode {
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
    // An armed draw tool owns every press — you draw over components too, so
    // select / drag and the InteractionManager are bypassed.
    const tool = this.activeToolMode();
    if (tool) {
      if (e.button === 0 && !e.shiftKey) {
        const point = this.clientToDiagram(e.clientX, e.clientY);
        if (point) {
          const wasActive = tool.active;
          tool.press(point);
          // A press-drag tool captures the pointer for the drag it just began.
          if (tool.pressDrag && tool.active && !wasActive) {
            this.pointerId = e.pointerId;
            capturePointer(this.canvas, e.pointerId);
          }
          this.syncToolMode(tool);
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
    const tool = this.activeToolMode();
    if (tool) {
      // A click tool rubber-bands on every move; a press-drag tool only while
      // its press is in flight. Suppress hover either way so components don't
      // light up mid-draw.
      const point = this.clientToDiagram(e.clientX, e.clientY);
      if (
        point &&
        (!tool.pressDrag || (tool.active && e.pointerId === this.pointerId))
      ) {
        tool.move(point);
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
    const tool = this.activeToolMode();
    if (tool) {
      // Only a press-drag tool commits on release; a click tool ignores it.
      if (tool.pressDrag && tool.active && e.pointerId === this.pointerId) {
        const point = this.clientToDiagram(e.clientX, e.clientY) ?? {
          x: 0,
          y: 0,
        };
        this.pointerId = -1;
        releasePointer(this.canvas, e.pointerId);
        tool.release(point);
        this.syncToolMode(tool);
      }
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
