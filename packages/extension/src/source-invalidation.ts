import * as vscode from "vscode";
import { qualifiedNameFromUri } from "./source-provider.js";

/** Evicts a class's cached sidebar icon so its next render re-elaborates. */
interface IconInvalidator {
  iconChanged(className: string): void;
}

/** The source provider's change broadcast, narrowed to what this wiring reads. */
interface SourceChangeBroadcaster {
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;
}

/**
 * Re-elaborate a sidebar icon whenever its class's source changes. A write
 * through the source provider can alter a class's `Icon` annotation, and the
 * sidebar's cheap annotation read lags a save behind unless the icon is
 * evicted. The change broadcast names the written class, so map each changed
 * `modelica-source:` URI back to its qualified name and invalidate that icon.
 */
export function syncIconsWithSource(
  source: SourceChangeBroadcaster,
  icons: IconInvalidator,
): vscode.Disposable {
  return source.onDidChangeFile((events) => {
    for (const event of events) {
      if (event.type !== vscode.FileChangeType.Changed) continue;
      const className = qualifiedNameFromUri(event.uri);
      if (className !== undefined) icons.iconChanged(className);
    }
  });
}
