/**
 * Reactive store for the scene's current view (pan/zoom/camera-mode +
 * a monotonic version that bumps on canvas resize, camera-mode flip,
 * and any other event that should force HTML overlays to reproject
 * even when {zoom, panX, panY} happen to be unchanged).
 *
 * Shape (literal): single producer (`<om-scene>`), many consumers
 * (every `<om-component>`, `<om-connector>` HTML overlay). Wire it
 * through Lit context — see `viewStateContext` below — so consumers
 * don't have to know where the store lives or hang listeners off the
 * document.
 *
 * Behaviour-subject semantics: subscribers receive the current value
 * immediately on subscribe, plus every subsequent emission. That lets
 * a freshly mounted shape position itself without a first paint at
 * (0, 0) before any pan happens.
 */

import { createContext } from "@lit/context";

import type { ViewState } from "./view-math.js";

export interface ViewSnapshot extends ViewState {
  /**
   * Bumps on every emission so consumers can compare-and-skip even
   * when the projected ViewState fields are identical (resize keeps
   * zoom/pan unchanged but the canvas aspect changed → overlays need
   * to reproject).
   */
  version: number;
}

type Listener = (s: ViewSnapshot) => void;

export class ViewStateStore {
  private snapshot: ViewSnapshot;
  private readonly listeners = new Set<Listener>();

  constructor(initial: ViewState) {
    this.snapshot = { ...initial, version: 0 };
  }

  get value(): ViewSnapshot {
    return this.snapshot;
  }

  /**
   * Push a new view snapshot. Always bumps `version`, so consumers
   * that only care about "something changed" can subscribe without
   * also diffing the payload.
   */
  next(s: ViewState): void {
    this.snapshot = { ...s, version: this.snapshot.version + 1 };
    for (const l of this.listeners) {
      l(this.snapshot);
    }
  }

  /**
   * Subscribe. Fires immediately with the current snapshot (so a
   * just-mounted overlay paints in the right place without waiting
   * for the next pan/zoom).
   */
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.snapshot);
    return () => {
      this.listeners.delete(l);
    };
  }
}

export const viewStateContext = createContext<ViewStateStore | null>(
  Symbol("om-view-state"),
);
