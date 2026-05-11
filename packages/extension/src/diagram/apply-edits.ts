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

export async function applyEdits(
  client: OmcClient,
  hostClass: string,
  edits: ReadonlyArray<LayoutEdit>,
): Promise<ApplyEditsResult> {
  const result: ApplyEditsResult = { applied: 0, failed: [] };

  // Deletions first so we don't re-add an edge that no longer has a
  // counterpart, then adds, then placement changes.
  const ordered = [...edits].sort((a, b) => order(a) - order(b));

  for (const edit of ordered) {
    try {
      await applyOne(client, hostClass, edit);
      result.applied++;
    } catch (err) {
      result.failed.push({ edit, error: (err as Error).message });
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
  }
}
