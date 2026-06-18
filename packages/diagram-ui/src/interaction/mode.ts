import {
  InteractionManager,
  type EmitFn,
  type PickerFn,
} from "./interaction-manager.js";
import {
  DragController,
  type ClientToDiagram,
  type DragEmit,
  type SelectionProvider,
} from "./drag-controller.js";
import type { InteractionStateStore, ModeId } from "./interaction-state.js";

/**
 * A top-level interaction mode — the tool that governs what a pointer
 * gesture means. The {@link ModeRouter} owns the canvas listeners and
 * forwards each event to the active mode; switching modes is a field
 * swap, never an `addEventListener`/`removeEventListener`. `select` is
 * the default; other tools (connect, draw-*) register alongside it.
 */
export interface InteractionMode {
  readonly id: ModeId;
  onPointerDown(e: PointerEvent): void;
  onPointerMove(e: PointerEvent): void;
  onPointerUp(e: PointerEvent): void;
  onPointerLeave(): void;
  /** Cursor / affordance setup when this mode becomes active. */
  onEnter?(): void;
  /** Cancel any in-flight gesture and clean up when it deactivates. */
  onExit?(): void;
  /**
   * Whether a pointer gesture owned by this mode is in flight. The host
   * uses it to suppress hover side-effects mid-gesture — it flips on
   * `pointerdown`, earlier than the interaction-store state transition.
   */
  isGestureActive(): boolean;
}

export interface SelectModeDeps {
  canvas: HTMLCanvasElement;
  picker: PickerFn;
  clientToDiagram: ClientToDiagram;
  getSelectionKeys: SelectionProvider;
  onInteraction: EmitFn;
  onDrag: DragEmit;
}

/**
 * The default mode: hit-test-driven hover / select / move / resize /
 * rotate / rubber-band / edge / connection, delegating to the
 * `InteractionManager` and `DragController` (both listener-free — the
 * router drives them). `InteractionManager` is forwarded first so its
 * hover emit precedes the drag-state transition, the ordering the host's
 * hover-suppression relies on.
 */
export class SelectMode implements InteractionMode {
  readonly id = "select";
  private readonly interactionManager: InteractionManager;
  private readonly dragController: DragController;

  constructor(deps: SelectModeDeps) {
    this.interactionManager = new InteractionManager(
      deps.picker,
      deps.onInteraction,
    );
    this.dragController = new DragController(
      deps.canvas,
      deps.picker,
      deps.clientToDiagram,
      deps.getSelectionKeys,
      deps.onDrag,
    );
  }

  onPointerDown(e: PointerEvent): void {
    this.interactionManager.handlePointerDown(e);
    this.dragController.handlePointerDown(e);
  }

  onPointerMove(e: PointerEvent): void {
    this.interactionManager.handlePointerMove(e);
    this.dragController.handlePointerMove(e);
  }

  onPointerUp(e: PointerEvent): void {
    this.interactionManager.handlePointerUp(e);
    this.dragController.handlePointerUp(e);
  }

  onPointerLeave(): void {
    this.interactionManager.handlePointerLeave();
  }

  isGestureActive(): boolean {
    return this.dragController.isActive;
  }
}

/**
 * Owns the single set of canvas pointer listeners for the lifetime of
 * the diagram and forwards each event to the active mode. Mode switches
 * swap the active strategy and run its `onEnter`/`onExit` — they never
 * touch the listeners, so there is no per-mode attach/detach churn.
 */
export class ModeRouter {
  private active: InteractionMode | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly modes: ReadonlyMap<ModeId, InteractionMode>,
    private readonly store: InteractionStateStore,
  ) {
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
  }

  setMode(id: ModeId): void {
    if (this.active?.id === id) {
      return;
    }
    const next = this.modes.get(id);
    if (!next) {
      throw new Error(`No interaction mode registered for "${id}".`);
    }
    this.active?.onExit?.();
    this.active = next;
    next.onEnter?.();
    this.store.next({ mode: id });
  }

  get activeId(): ModeId | null {
    return this.active?.id ?? null;
  }

  isGestureActive(): boolean {
    return this.active?.isGestureActive() ?? false;
  }

  destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.active?.onExit?.();
    this.active = null;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.active?.onPointerDown(e);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.active?.onPointerMove(e);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.active?.onPointerUp(e);
  };

  private readonly onPointerLeave = (): void => {
    this.active?.onPointerLeave();
  };
}
