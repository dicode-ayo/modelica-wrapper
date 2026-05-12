/**
 * Virtual readonly text documents for Modelica source listings.
 *
 * URIs are of the form `modelica-source:/<QualifiedName>.mo`. The path is the
 * dotted Modelica name (e.g. `Modelica.Blocks.Math.Add`) suffixed with `.mo`
 * so the editor tab shows a familiar filename. Content is whatever OMC's
 * `listFile(<qualified>)` returns — the pretty-printed Modelica source.
 *
 * Documents are read-only; persistent edits go through the `.mo` files on
 * disk after `Save Package As…`.
 */

import * as vscode from "vscode";

import type { OmcClient } from "@modelica-wrapper/omc-client";

export const MODELICA_SOURCE_SCHEME = "modelica-source";

type EnsureClient = () => Promise<OmcClient>;

export class ModelicaSourceProvider
  implements vscode.TextDocumentContentProvider
{
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly ensureClient: EnsureClient) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const typeName = qualifiedNameFromUri(uri);
    if (!typeName) {
      return `// Could not parse type name from URI ${uri.toString()}`;
    }
    const client = await this.ensureClient();
    const { contents } = await client.listFile({ typeName });
    return contents;
  }

  /** Re-fetch all open source documents — call after edits / loads. */
  refreshAll(): void {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === MODELICA_SOURCE_SCHEME) {
        this._onDidChange.fire(doc.uri);
      }
    }
  }
}

export function sourceUriFor(qualifiedName: string): vscode.Uri {
  return vscode.Uri.parse(`${MODELICA_SOURCE_SCHEME}:/${qualifiedName}.mo`);
}

export function qualifiedNameFromUri(uri: vscode.Uri): string | undefined {
  if (uri.scheme !== MODELICA_SOURCE_SCHEME) return undefined;
  const path = uri.path.replace(/^\//, "");
  return path.endsWith(".mo") ? path.slice(0, -3) : path;
}
