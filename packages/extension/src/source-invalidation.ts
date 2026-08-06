import * as vscode from "vscode";

import type { ClassInvalidationRegistry } from "./invalidation.js";
import { qualifiedNameFromUri } from "./source-provider.js";

/** The source provider's change broadcast, narrowed to what this wiring reads. */
interface SourceChangeBroadcaster {
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;
}

/**
 * Turn the source provider's change broadcast into class-invalidation signals.
 *
 * Every write that reaches OMC — a save through the virtual filesystem, a
 * mutation command's `notifySourceChanged`, the `.mo` watcher reloading a
 * foreign edit — ends in this broadcast, so it is the single producer feeding
 * {@link ClassInvalidationRegistry}. Routing the caches off it rather than off
 * each producer is what keeps a class from being invalidated once per producer
 * that happened to fire.
 */
export function publishSourceChanges(
  source: SourceChangeBroadcaster,
  invalidation: ClassInvalidationRegistry,
): vscode.Disposable {
  return source.onDidChangeFile((events) => {
    for (const event of events) {
      if (event.type !== vscode.FileChangeType.Changed) continue;
      const className = qualifiedNameFromUri(event.uri);
      if (className !== undefined) invalidation.classChanged(className);
    }
  });
}
