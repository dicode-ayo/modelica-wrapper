import type { DiagramLayout } from "@dicode/omc-client";

import { gestureOrdering, type WebviewToExtension } from "./gestures.js";

// Long enough to swallow a re-drag, short enough that a deliberate second edit
// a beat later still lands on its own.
const COMMIT_DEBOUNCE_MS = 300;

/** The `setTimeout` pair, injectable so tests drive the debounce directly. */
export interface CommitScheduler {
  schedule(fn: () => void, delayMs: number): { cancel(): void };
}

const defaultScheduler: CommitScheduler = {
  schedule(fn, delayMs) {
    const id = setTimeout(fn, delayMs);
    return { cancel: () => clearTimeout(id) };
  },
};

/**
 * Holds the layout the diagram has committed but the host has not been told
 * about yet, and answers what may happen while it is held.
 *
 * Consecutive gestures collapse into one report: each commit carries the whole
 * layout, so an earlier one holds nothing a later one lacks, and the host pays
 * for one reconcile instead of one per gesture.
 */
export class CommitSlot {
  private queued: DiagramLayout | null = null;
  private timer: { cancel(): void } | undefined;
  /** True from a refused/discarded `layout` push (per {@link takePush}) until
   *  the next one actually lands. Read alongside the layout by `send`. */
  private stale = false;

  constructor(
    private readonly send: (layout: DiagramLayout, staleBase: boolean) => void,
    private readonly scheduler: CommitScheduler = defaultScheduler,
  ) {}

  /** Take a commit, replacing any still waiting, and restart the debounce. */
  commit(layout: DiagramLayout): void {
    this.queued = layout;
    this.timer?.cancel();
    this.timer = this.scheduler.schedule(
      () => this.flush(),
      COMMIT_DEBOUNCE_MS,
    );
  }

  /** Send a held commit ahead of `type` when it cannot be overtaken. */
  beforeSending(type: WebviewToExtension["type"]): void {
    if (gestureOrdering(type) === "afterCommit") this.flush();
  }

  /**
   * Whether an arriving layout push may be applied, recording the verdict: a
   * refused push leaves the diagram showing state the host does not know it
   * has not seen, which rides out on the next commit as `staleBase`.
   *
   * The host settles once its own queue drains, which says nothing about work
   * the webview has not sent yet — a commit still held here, or a gesture that
   * has committed nothing at all. A push raised without sight of either is
   * older than what is on screen, and applying it puts the user's own edit
   * back undone until the settle for it arrives.
   */
  takePush(gestureActive: boolean): boolean {
    const applicable = !gestureActive && this.queued === null;
    this.stale = !applicable;
    return applicable;
  }

  /** Send whatever is held, now — the debounce is an optimisation, and losing
   *  a commit to a teardown is not a trade it is allowed to make. */
  flush(): void {
    this.timer?.cancel();
    this.timer = undefined;
    const layout = this.queued;
    if (layout === null) return;
    this.queued = null;
    this.send(layout, this.stale);
  }
}
