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
 * Every write that reaches OMC through one of our own commands — a save
 * through the virtual filesystem, a mutation command's
 * `notifySourceChanged(typeName)`, the `.mo` watcher reloading a foreign edit
 * — ends in this broadcast, so a command needs no listener wiring of its own.
 *
 * It is not the only producer: `omc-mutation.ts` announces whatever reaches
 * OMC without passing through a command at all, which is the REPL and anything
 * else driving the client directly. A write that goes through both is
 * announced twice; the cost is one redundant re-read.
 *
 * The argument-less `notifySourceChanged()` announces only the classes open in
 * an editor. It follows class creation, where nothing is cached yet.
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
