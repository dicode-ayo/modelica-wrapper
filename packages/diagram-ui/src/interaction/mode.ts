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
 * A top-level interaction mode owns the canvas pointer gestures while it
 * is active. The {@link ModeRouter} keeps exactly one mode active and
 * swaps the listeners when the mode changes. `select` is the default;
 * other tools (connect, draw-*) register alongside it.
 */
export interface InteractionMode {
  readonly id: ModeId;
  activate(): void;
  deactivate(): void;
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
 * rotate / rubber-band / edge / connection, via the existing
 * `InteractionManager` + `DragController`.
 */
export class SelectMode implements InteractionMode {
  readonly id = "select";
  private interactionManager: InteractionManager | null = null;
  private dragController: DragController | null = null;

  constructor(private readonly deps: SelectModeDeps) {}

  activate(): void {
    const d = this.deps;
    this.interactionManager = new InteractionManager(
      d.canvas,
      d.picker,
      d.onInteraction,
    );
    this.dragController = new DragController(
      d.canvas,
      d.picker,
      d.clientToDiagram,
      d.getSelectionKeys,
      d.onDrag,
    );
  }

  deactivate(): void {
    this.interactionManager?.destroy();
    this.dragController?.destroy();
    this.interactionManager = null;
    this.dragController = null;
  }

  isGestureActive(): boolean {
    return this.dragController?.isActive ?? false;
  }
}

/**
 * Holds the registered modes and keeps exactly one active, swapping
 * canvas listeners on a mode change and publishing the active mode to
 * the interaction store.
 */
export class ModeRouter {
  private active: InteractionMode | null = null;

  constructor(
    private readonly modes: ReadonlyMap<ModeId, InteractionMode>,
    private readonly store: InteractionStateStore,
  ) {}

  setMode(id: ModeId): void {
    if (this.active?.id === id) {
      return;
    }
    const next = this.modes.get(id);
    if (!next) {
      return;
    }
    this.active?.deactivate();
    this.active = next;
    next.activate();
    this.store.next({ mode: id });
  }

  get activeId(): ModeId | null {
    return this.active?.id ?? null;
  }

  isGestureActive(): boolean {
    return this.active?.isGestureActive() ?? false;
  }

  destroy(): void {
    this.active?.deactivate();
    this.active = null;
  }
}
