import type { LinesMesh, Scene, TransformNode } from "@babylonjs/core";

import type {
  DiagramPoint,
  DragEmit,
  GestureMode,
  GestureStart,
} from "./gesture-mode.js";
import {
  buildRectMesh,
  updateRectMesh,
  disposeOverlayMesh,
} from "../base/overlay-mesh.js";

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Area selection: a drag on empty canvas rubber-bands out a rectangle.
 * Owns and draws the rectangle; the host consumes the emitted `rubberBand`
 * events to update the selection. Click-select and hover are not part of
 * this mode — they run always in the `InteractionManager`, underneath
 * every gesture.
 */
export class SelectMode implements GestureMode {
  readonly id = "select";
  private start: DiagramPoint | null = null;
  private rect: LinesMesh | null = null;

  constructor(
    private readonly emit: DragEmit,
    private readonly scene: Scene,
    private readonly parent: TransformNode,
  ) {}

  /** Build the outline once, then rewrite its corners in place — a fixed
   *  5-point topology, so it never needs a flickery dispose/rebuild. */
  private drawRect(rect: Rect): void {
    if (this.rect) {
      updateRectMesh(this.rect, rect);
    } else {
      this.rect = buildRectMesh(this.scene, this.parent, rect);
    }
  }

  private clearRect(): void {
    disposeOverlayMesh(this.rect);
    this.rect = null;
  }

  cancel(): void {
    this.start = null;
    this.clearRect();
  }

  begin(start: GestureStart): boolean {
    if (start.entity) {
      return false;
    }
    this.start = { x: start.point.x, y: start.point.y };
    const rect = {
      x1: start.point.x,
      y1: start.point.y,
      x2: start.point.x,
      y2: start.point.y,
    };
    this.drawRect(rect);
    this.emit("rubberBand", { rect, draft: true });
    return true;
  }

  update(point: DiagramPoint): void {
    if (this.start) {
      const rect = {
        x1: this.start.x,
        y1: this.start.y,
        x2: point.x,
        y2: point.y,
      };
      this.drawRect(rect);
      this.emit("rubberBand", { rect, draft: true });
    }
  }

  commit(point: DiagramPoint): void {
    if (!this.start) {
      return;
    }
    const s = this.start;
    this.start = null;
    this.clearRect();
    this.emit("rubberBand", {
      rect: { x1: s.x, y1: s.y, x2: point.x, y2: point.y },
      draft: false,
    });
  }
}
