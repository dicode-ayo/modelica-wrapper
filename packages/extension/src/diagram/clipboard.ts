import type { Extent, Shape } from "@dicode/omc-client";

/**
 * Diagram units each successive paste of one copy is offset by, so repeated
 * ⌘V cascades instead of stacking every copy on the same coordinates.
 */
export const PASTE_OFFSET = 20;

/** A modifier authored on a declaration: `path` bound to a Modelica expression. */
export interface ClipboardModifier {
  /** Modifier path relative to the declaration, e.g. `k` or `limiter.uMax`. */
  path: string;
  expr: string;
}

/** A copied sub-component or standalone connector. */
export interface ClipboardComponent {
  kind: "component";
  /** Instance name at copy time — the base the pasted instance's name derives from. */
  name: string;
  /** Qualified class of the instance. */
  className: string;
  extent: Extent;
  rotation: number;
  /**
   * Modifiers read off the declaration at copy time, replayed onto the pasted
   * instance. Only what the source actually authored: `addComponent` writes a
   * bare declaration, so anything inherited or defaulted stays inherited.
   */
  modifiers: readonly ClipboardModifier[];
}

/**
 * A copied graphics primitive. The source layer isn't recorded — paste writes
 * to whichever layer the receiving editor edits, so a shape copied off a
 * diagram lands on an icon when pasted into the icon editor.
 */
export interface ClipboardShape {
  kind: "shape";
  shape: Shape;
}

export type ClipboardEntry = ClipboardComponent | ClipboardShape;

/**
 * The diagram clipboard, shared by every open diagram/icon editor in the
 * window so a copy in one class pastes into another. Memory-only: the payload
 * is our own shape, not Modelica text, and never reaches the system clipboard.
 */
export class DiagramClipboard {
  private items: readonly ClipboardEntry[] = [];
  // Per host class: the cascade exists so a second paste doesn't land on the
  // first, which is only true within one class. A window-wide counter would
  // offset the first paste into a second model by however many times the
  // clipboard had been pasted into the first.
  private readonly pastes = new Map<string, number>();

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  read(): readonly ClipboardEntry[] {
    return this.items;
  }

  write(items: readonly ClipboardEntry[]): void {
    this.items = items;
    this.pastes.clear();
  }

  /** Offset for the next paste of the current contents into `hostClass`. */
  nextOffset(hostClass: string): number {
    const n = (this.pastes.get(hostClass) ?? 0) + 1;
    this.pastes.set(hostClass, n);
    return n * PASTE_OFFSET;
  }
}

/** Window-wide instance; the one every editor session shares. */
export const diagramClipboard = new DiagramClipboard();

/** Translate an extent by `(d, d)` — the paste offset applied to a placement. */
export function offsetExtent(extent: Extent, d: number): Extent {
  const [[x1, y1], [x2, y2]] = extent;
  return [
    [x1 + d, y1 + d],
    [x2 + d, y2 + d],
  ];
}

/**
 * Translate a shape by `(d, d)` through its `origin`. Every shape kind carries
 * `origin` and renders its geometry relative to it (§18.6), so shifting origin
 * moves `extent`-based and `points`-based primitives alike.
 */
export function offsetShape(shape: Shape, d: number): Shape {
  const [ox, oy] = shape.origin ?? [0, 0];
  return { ...shape, origin: [ox + d, oy + d] };
}
