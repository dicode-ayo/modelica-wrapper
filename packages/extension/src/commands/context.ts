/**
 * Shared inputs and helpers that every command module receives. Wiring these
 * once in `extension.ts` lets each command file stay focused on its own logic.
 */

import * as vscode from "vscode";

import type { OmcClient } from "@modelica-wrapper/omc-client";

import type { LibraryTreeProvider, LibraryNode } from "../tree/library-tree.js";
import type { ModelicaSourceProvider } from "../source-provider.js";

export interface CommandContext {
  /** Forwarded so commands that need extension assets (e.g. webview HTML) can reach them. */
  readonly extensionContext: vscode.ExtensionContext;
  /** Lazy OMC client accessor — spawns OMC on first call, then caches. */
  readonly ensureClient: () => Promise<OmcClient>;
  /** Activity-bar library tree; commands call `.refresh()` after mutations. */
  readonly libraryTree: LibraryTreeProvider;
  /** Virtual `modelica-source:` file-system provider; commands fire `notifySourceChanged(typeName)`
   *  after mutations to invalidate any open editors backed by this scheme. */
  readonly sourceProvider: ModelicaSourceProvider;
}

/**
 * Modelica identifier: letter or underscore, then letters/digits/underscores.
 * Returns an error string for `validateInput` or `undefined` if valid.
 */
export function validateIdentifier(value: string): string | undefined {
  if (!value) return "Name is required";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    return "Must be a valid Modelica identifier (letters, digits, underscore; not starting with a digit)";
  }
  return undefined;
}

/** Pull the qualified parent name from a tree node, if it's an expandable container. */
export function parentFromNode(node: LibraryNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.restriction === "package" || node.restriction === "library") {
    return node.qualifiedName;
  }
  return undefined;
}

/**
 * Send a generated `loadString` snippet to OMC, surface OMC errors via
 * `getErrorString`, and refresh the views. Returns `true` on success.
 */
export async function runLoadString(
  ctx: CommandContext,
  data: string,
  qualified: string,
  failurePrefix: string,
): Promise<boolean> {
  try {
    const c = await ctx.ensureClient();
    const { success } = await c.loadString({
      data,
      filename: `<runtime:${qualified}>`,
      merge: true,
    });
    if (!success) {
      const { errorString } = await c.getErrorString();
      await vscode.window.showErrorMessage(
        `${failurePrefix} ${qualified}${errorString ? `: ${errorString}` : ""}`,
      );
      return false;
    }
    ctx.libraryTree.refresh();
    // No specific typeName here — `runLoadString` is used by class creation,
    // which loads a fresh class and we don't know if other open buffers are
    // affected. Invalidate every open `modelica-source:` editor.
    ctx.sourceProvider.notifySourceChanged();
    return true;
  } catch (err) {
    await vscode.window.showErrorMessage(
      `${failurePrefix} ${qualified}: ${(err as Error).message}`,
    );
    return false;
  }
}
