import type { DiagramLayout } from "@dicode/omc-client";

import type { WebviewToExtension } from "./protocol.js";

// Long enough to swallow a re-drag, short enough that a deliberate second edit
// a beat later still lands on its own.
const COMMIT_DEBOUNCE_MS = 300;

/**
 * Messages that say nothing about the model. A queued commit may stay queued
 * behind these — and must, for `selectionChange`: a drag reports its selection
 * on press and its commit on release, so flushing on selection would end the
 * coalescing before it starts.
 */
const UI_ONLY: ReadonlySet<WebviewToExtension["type"]> = new Set([
  "ready",
  "selectionChange",
  "inputFocus",
]);

/**
 * Whether a queued commit has to reach the host before `type` does. Anything
 * that reads or writes the class is describing the diagram that commit
 * produced, so it cannot overtake it. Unknown-to-this-list types answer `true`:
 * a message added later orders conservatively until someone decides otherwise.
 */
export function mustFollowQueuedChange(
  type: WebviewToExtension["type"],
): boolean {
  return !UI_ONLY.has(type);
}

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

  constructor(
    private readonly send: (layout: DiagramLayout) => void,
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
    if (mustFollowQueuedChange(type)) this.flush();
  }

  /**
   * Whether an arriving layout push may be applied. The host settles once its
   * own queue drains, which says nothing about work the webview has not sent
   * yet — a commit still held here, or a gesture that has committed nothing at
   * all. A push raised without sight of either is older than what is on screen,
   * and applying it puts the user's own edit back undone until the settle for
   * it arrives.
   */
  canApplyPush(gestureActive: boolean): boolean {
    return !gestureActive && this.queued === null;
  }

  /** Send whatever is held, now — the debounce is an optimisation, and losing
   *  a commit to a teardown is not a trade it is allowed to make. */
  flush(): void {
    this.timer?.cancel();
    this.timer = undefined;
    const layout = this.queued;
    if (layout === null) return;
    this.queued = null;
    this.send(layout);
  }
}
