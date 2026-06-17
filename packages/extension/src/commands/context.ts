/**
 * Shared inputs and helpers that every command module receives. Wiring these
 * once in `extension.ts` lets each command file stay focused on its own logic.
 */

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

import type { LibraryTreeProvider, LibraryNode } from "../tree/library-tree.js";
import type { ModelicaSourceProvider } from "../source-provider.js";

export interface CommandContext {
  /** Forwarded so commands that need extension assets (e.g. webview HTML) can reach them. */
  readonly extensionContext: vscode.ExtensionContext;
  /** Lazy OMC client accessor — spawns OMC on first call, then caches. */
  readonly ensureClient: () => Promise<OmcClient>;
  /**
   * Close the cached OMC subprocess and spawn a fresh one. Used by the
   * REPL's `:reset` meta-command — the only flow that wants to wipe OMC
   * state without ending the user's editor session. Optional so older
   * `extension.ts` wirings still type-check.
   */
  readonly resetClient?: () => Promise<OmcClient>;
  /** Activity-bar library tree; commands call `.refresh()` after mutations. */
  readonly libraryTree: LibraryTreeProvider;
  /** Virtual `modelica-source:` file-system provider; commands fire `notifySourceChanged(typeName)`
   *  after mutations to invalidate any open editors backed by this scheme. */
  readonly sourceProvider: ModelicaSourceProvider;
  /** Shared `vscode.DiagnosticCollection("modelica")` for OMC-emitted diagnostics. */
  readonly diagnostics: vscode.DiagnosticCollection;
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

/**
 * Turn an arbitrary string (e.g. a folder name) into a valid Modelica
 * identifier. Replaces runs of non-identifier characters with `_`; prepends
 * `_` when the result would start with a digit; falls back to `_` for an
 * empty input.
 */
export function sanitizeIdentifier(value: string): string {
  let s = value.replace(/[^A-Za-z0-9_]+/g, "_");
  // Strip injected leading underscores only when the original didn't start
  // with one — this removes padding introduced by a leading invalid character
  // without clobbering an intentional leading underscore.
  if (!value.startsWith("_")) {
    s = s.replace(/^_+/, "");
  }
  if (!s) return "_";
  if (/^[0-9]/.test(s)) return `_${s}`;
  return s;
}

/** Pull the qualified parent name from a tree node, if it's an expandable container. */
export function parentFromNode(
  node: LibraryNode | undefined,
): string | undefined {
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
