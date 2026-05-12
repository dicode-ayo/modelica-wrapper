/**
 * `modelica.createComponent` — quick-pick a class kind, prompt for a name,
 * generate `within Parent;\n<kind> Name\nend Name;\n` and load it.
 */

import * as vscode from "vscode";

import type { LibraryNode } from "../tree/library-tree.js";

import {
  parentFromNode,
  runLoadString,
  validateIdentifier,
  type CommandContext,
} from "./context.js";

const COMPONENT_KINDS = [
  "model",
  "block",
  "connector",
  "function",
  "record",
  "type",
] as const;
type ComponentKind = (typeof COMPONENT_KINDS)[number];

export function registerComponentCommands(ctx: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      "modelica.createComponent",
      async (node?: LibraryNode) => {
        const parent = parentFromNode(node);
        const kind = (await vscode.window.showQuickPick([...COMPONENT_KINDS], {
          placeHolder: "Class kind",
          title: parent ? `New component inside ${parent}` : "New top-level component",
        })) as ComponentKind | undefined;
        if (!kind) return;
        const name = await vscode.window.showInputBox({
          prompt: parent ? `New ${kind} inside ${parent}` : `New top-level ${kind}`,
          placeHolder: `My${kind[0]!.toUpperCase()}${kind.slice(1)}`,
          validateInput: validateIdentifier,
        });
        if (!name) return;
        const qualified = parent ? `${parent}.${name}` : name;
        const data = parent
          ? `within ${parent};\n${kind} ${name}\nend ${name};\n`
          : `${kind} ${name}\nend ${name};\n`;
        await runLoadString(ctx, data, qualified, "Modelica: failed to create");
      },
    ),
  ];
}
