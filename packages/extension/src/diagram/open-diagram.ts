import * as vscode from "vscode";
import { OmcClient, diagram } from "@modelica-wrapper/omc-client";

import { DiagramPanel } from "./panel.js";

/**
 * `Modelica: Open Diagram` command handler. Resolves the target class
 * from either the command argument or a quick-pick prompt, calls
 * `getModelInstance(typeName)` (which already parses + validates the
 * structured AST), runs `diagram.produceDiagramLayout` to derive a
 * `DiagramLayout`, and opens (or focuses) a `DiagramPanel` for it.
 *
 * Mutation wiring (F3) plugs in via the `handlers` arg.
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
  try {
    const { instance } = await client.invoke("getModelInstance", {
      typeName: className,
    });
    const layout = diagram.produceDiagramLayout(instance, "diagram");
    DiagramPanel.open(context.extensionUri, className, layout, {
      onChange: (l) => {
        // F3 will translate diff(old, l) into granular omc-client edits.
        void vscode.window.setStatusBarMessage(
          `Diagram change pending (${Object.keys(l.components).length} components)`,
          3000,
        );
      },
      onConnectionCreate: (fromKey, toKey) => {
        void vscode.window.setStatusBarMessage(
          `Connection create requested: ${fromKey} → ${toKey}`,
          3000,
        );
      },
    });
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Modelica: failed to open diagram for ${className}: ${(err as Error).message}`,
    );
  }
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
