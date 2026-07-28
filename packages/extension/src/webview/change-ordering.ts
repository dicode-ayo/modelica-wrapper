import type { WebviewToExtension } from "./protocol.js";

/**
 * Messages that say nothing about the model. A commit queued behind the
 * webview's debounce may stay queued behind these — and must, for
 * `selectionChange`: a drag reports its selection on press and its commit on
 * release, so flushing on selection would end the coalescing before it starts.
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

/**
 * Whether an arriving layout push may be applied.
 *
 * The host settles once its queue drains, which says nothing about work the
 * webview has not sent yet: a commit still inside the debounce, or a gesture
 * that has not committed at all. A push raised without sight of either is
 * older than what is on screen, and applying it puts the user's own edit back
 * undone until the settle for it arrives. Whatever is held locally is the
 * newer statement of the diagram, and it produces a settle of its own.
 */
export function canApplyLayoutPush(state: {
  gestureActive: boolean;
  hasQueuedChange: boolean;
}): boolean {
  return !state.gestureActive && !state.hasQueuedChange;
}
