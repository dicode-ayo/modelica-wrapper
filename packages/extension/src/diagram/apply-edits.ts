import { OmcClient } from "@modelica-wrapper/omc-client";

import {
  lineAnnotation,
  placementAnnotation,
  type LayoutEdit,
} from "./diff-layout.js";

/**
 * Translates `LayoutEdit[]` (from `diffLayouts`) into omc-client calls
 * against the host class.
 *
 * Returns a summary describing what was applied and what failed so the
 * caller can surface diagnostics. Edits are applied sequentially —
 * OMC's interactive scripting API isn't transaction-safe across
 * concurrent calls.
 */

export interface ApplyEditsResult {
  applied: number;
  failed: Array<{ edit: LayoutEdit; error: string }>;
}

/**
 * Callback invoked per edit after the OMC call resolves (success or
 * failure). `command` is the raw OMC call we sent (`client.lastCall`),
 * useful as a REPL transcript label. `error` is undefined on success.
 *
 * The caller passes a function that mirrors each step into the
 * Modelica REPL, the same way the addComponent / simulate flows do.
 * Kept optional so non-UI callers don't have to thread anything.
 */
export type ApplyEditsHook = (
  edit: LayoutEdit,
  command: string,
  error: string | undefined,
) => void;

export async function applyEdits(
  client: OmcClient,
  hostClass: string,
  edits: ReadonlyArray<LayoutEdit>,
  onApplied?: ApplyEditsHook,
): Promise<ApplyEditsResult> {
  const result: ApplyEditsResult = { applied: 0, failed: [] };

  // Deletions first so we don't re-add an edge that no longer has a
  // counterpart, then adds, then placement changes.
  const ordered = [...edits].sort((a, b) => order(a) - order(b));

  for (const edit of ordered) {
    try {
      await applyOne(client, hostClass, edit);
      result.applied++;
      onApplied?.(edit, client.lastCall ?? "(no command)", undefined);
    } catch (err) {
      const msg = (err as Error).message;
      result.failed.push({ edit, error: msg });
      onApplied?.(edit, client.lastCall ?? "(no command)", msg);
    }
  }
  return result;
}

function order(e: LayoutEdit): number {
  switch (e.kind) {
    case "connectionDeleted":
      return 0;
    case "componentDeleted":
      return 1;
    case "connectionAdded":
      return 2;
    case "componentPlacement":
      return 3;
    case "connectionWaypoints":
      // Run after placement edits so the REPL transcript reads
      // top-down: structural deletes/adds, then the moved component,
      // then the re-routed wires that follow it.
      return 4;
    case "connectionRenamed":
      // An in-place endpoint rewrite (vector-port re-index, issue #26).
      // Ordered alongside the other connection edits; the single
      // `updateConnectionNames` RPC neither adds nor removes an edge, so
      // its position relative to placement is immaterial.
      return 4;
  }
}

async function applyOne(
  client: OmcClient,
  hostClass: string,
  edit: LayoutEdit,
): Promise<void> {
  switch (edit.kind) {
    case "componentPlacement":
      await client.invoke("updateComponent", {
        componentName: edit.componentName,
        componentClass: edit.componentClass,
        intoTypeName: hostClass,
        annotation: placementAnnotation(edit.extent, edit.rotation),
      });
      return;
    case "componentDeleted":
      await client.invoke("deleteComponent", {
        componentName: edit.componentName,
        typeName: hostClass,
      });
      return;
    case "connectionAdded":
      await client.invoke("addConnection", {
        from: edit.from,
        to: edit.to,
        typeName: hostClass,
        annotation: lineAnnotation(edit.waypoints),
      });
      return;
    case "connectionDeleted":
      await client.invoke("deleteConnection", {
        from: edit.from,
        to: edit.to,
        typeName: hostClass,
      });
      return;
    case "connectionWaypoints":
      // `updateConnection` was previously thought to be missing on
      // OMC 1.26.x and we re-routed via delete+add. The wrapper has
      // since been rescued (the OMC docs put `className` first and
      // require `from` / `to` as quoted Strings — see
      // packages/omc-client/docs/audit.md §2.10). Single RPC now.
      await client.invoke("updateConnection", {
        typeName: hostClass,
        from: edit.from,
        to: edit.to,
        annotation: lineAnnotation(edit.waypoints),
      });
      return;
    case "connectionRenamed":
      // Vector-port re-index (issue #26): rewrite the endpoint
      // identifiers in place via a single `updateConnectionNames` RPC
      // instead of delete+add, keeping the file diff minimal and the
      // existing `Line(points=...)` annotation intact.
      await client.invoke("updateConnectionNames", {
        typeName: hostClass,
        from: edit.oldFrom,
        to: edit.oldTo,
        fromNew: edit.newFrom,
        toNew: edit.newTo,
      });
      return;
  }
}
