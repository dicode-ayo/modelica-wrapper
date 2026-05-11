import * as vscode from "vscode";
import {
  OmcClient,
  diagram,
  type DiagramLayout,
} from "@modelica-wrapper/omc-client";

import { DiagramPanel } from "./panel.js";
import { diffLayouts, lineAnnotation } from "./diff-layout.js";
import { applyEdits } from "./apply-edits.js";

/**
 * `Modelica: Open Diagram` command handler. Resolves the target class
 * from either the command argument or a quick-pick prompt, fetches and
 * derives the `DiagramLayout`, opens (or focuses) a `DiagramPanel`,
 * and wires:
 *
 *   onChange           → diff + applyEdits + re-fetch + refresh panel
 *   onConnectionCreate → omc-client.addConnection + re-fetch + refresh
 *
 * F3 keeps the previous-layout reference per session so the next
 * diff is always against the most-recent OMC truth, not the user's
 * in-flight draft.
 */
export async function openDiagram(
  context: vscode.ExtensionContext,
  client: OmcClient,
  arg: unknown,
): Promise<void> {
  const className = await resolveClassName(arg);
  if (!className) {
    return;
  }
  let prevLayout: DiagramLayout;
  try {
    prevLayout = await fetchLayout(client, className);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Modelica: failed to open diagram for ${className}: ${(err as Error).message}`,
    );
    return;
  }

  const panel = DiagramPanel.open(context.extensionUri, className, prevLayout, {
    onChange: async (next) => {
      const edits = diffLayouts(prevLayout, next);
      if (edits.length === 0) {
        return;
      }
      const result = await applyEdits(client, className, edits);
      if (result.failed.length > 0) {
        const first = result.failed[0]!;
        void vscode.window.showWarningMessage(
          `Modelica: ${result.failed.length} of ${edits.length} edits failed (${first.error}).`,
        );
      }
      try {
        prevLayout = await fetchLayout(client, className);
        panel.update(prevLayout);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Modelica: re-fetch after edits failed: ${(err as Error).message}`,
        );
      }
    },
    onConnectionCreate: async (fromKey, toKey) => {
      const from = keyToCref(prevLayout, fromKey);
      const to = keyToCref(prevLayout, toKey);
      if (!from || !to) {
        void vscode.window.showWarningMessage(
          `Modelica: connection endpoints not found (${fromKey}, ${toKey})`,
        );
        return;
      }
      try {
        await client.invoke("addConnection", {
          from,
          to,
          typeName: className,
          annotation: lineAnnotation([]),
        });
        prevLayout = await fetchLayout(client, className);
        panel.update(prevLayout);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Modelica: addConnection failed: ${(err as Error).message}`,
        );
      }
    },
  });
}

async function fetchLayout(
  client: OmcClient,
  className: string,
): Promise<DiagramLayout> {
  const { instance } = await client.invoke("getModelInstance", {
    typeName: className,
  });
  return diagram.produceDiagramLayout(instance, "diagram");
}

async function resolveClassName(arg: unknown): Promise<string | undefined> {
  if (typeof arg === "string" && arg.length > 0) {
    return arg;
  }
  const input = await vscode.window.showInputBox({
    prompt: "Class to render (e.g. Modelica.Blocks.Examples.PID_Controller)",
    placeHolder: "Modelica.Blocks.Examples.PID_Controller",
  });
  return input ?? undefined;
}

/**
 * Maps a UI entity key (`c:R1`, `k:p`) to the omc-client connector
 * reference (`R1.p` or `p`). The host class itself owns standalone
 * connectors directly; nested connectors live under a component.
 */
function keyToCref(layout: DiagramLayout, key: string): string | null {
  const idx = key.indexOf(":");
  if (idx < 0) {
    return null;
  }
  const prefix = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if (prefix === "k") {
    // Could be host-level connector OR a port nested in a component;
    // we can't tell from the bare key without context. The current
    // emit path is `k:<portName>` for both. Prefer a match against
    // host-level connectors first, then look for a component port
    // exposing that name.
    if (layout.connectors[id]) {
      return id;
    }
    for (const [compName, comp] of Object.entries(layout.components)) {
      const cls = layout.classes[comp.classRef];
      if (cls && cls.connectors[id]) {
        return `${compName}.${id}`;
      }
    }
    return id;
  }
  return null;
}
