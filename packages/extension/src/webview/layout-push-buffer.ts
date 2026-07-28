import type { ExtensionToWebview } from "./protocol.js";

export type LayoutPush = Extract<ExtensionToWebview, { type: "layout" }>;

/**
 * The webview's side of the layout-revision contract: which layout it is
 * showing, and whether it may accept the next one yet.
 *
 * A push that lands mid-gesture would swap the base out from under the pointer
 * — `<om-graphical-layout>` drops its draft on any external `layout` swap — so
 * it is held until the gesture ends. The revision it carries rides back out on
 * every edit, naming the layout that edit was made from.
 */
export class LayoutPushBuffer {
  private held: LayoutPush | null = null;
  private current = 0;

  /** Revision of the layout on screen; the base of any edit committed now. */
  get revision(): number {
    return this.current;
  }

  /** Whether a push is waiting for the gesture to end. */
  get hasHeld(): boolean {
    return this.held !== null;
  }

  /**
   * Take a push in. Returns it when it may be applied now, or `null` when it
   * has been held. Only the newest is kept: an older push is superseded by
   * definition, never applied after one that followed it.
   */
  receive(push: LayoutPush, gestureActive: boolean): LayoutPush | null {
    if (gestureActive) {
      this.held = push;
      return null;
    }
    this.held = null;
    this.current = push.revision;
    return push;
  }

  /** The held push now that the gesture has ended, or `null` if none. */
  release(): LayoutPush | null {
    const push = this.held;
    if (push === null) return null;
    this.held = null;
    this.current = push.revision;
    return push;
  }

  /** An `init` reseeds the webview outright, superseding anything held. */
  reset(revision: number): void {
    this.held = null;
    this.current = revision;
  }
}
