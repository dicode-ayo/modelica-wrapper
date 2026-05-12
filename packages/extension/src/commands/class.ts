/**
 * `modelica.createClass` — single entry point for creating any kind of
 * Modelica class. Quick-picks a kind (package / model / block / connector /
 * function / record / type), prompts for a name, then loads
 * `within Parent;\n<kind> Name\nend Name;\n` via OMC.
 *
 * Works from:
 *   - title bar (no parent → top-level class)
 *   - context menu on a library or package node (any depth → nested class)
 */

import * as vscode from "vscode";

import type { LibraryNode } from "../tree/library-tree.js";

import {
  parentFromNode,
  runLoadString,
  validateIdentifier,
  type CommandContext,
} from "./context.js";

const CLASS_KINDS = [
  "package",
  "model",
  "block",
  "connector",
  "function",
  "record",
  "type",
] as const;
type ClassKind = (typeof CLASS_KINDS)[number];

export function registerClassCommands(ctx: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      "modelica.createClass",
      async (node?: LibraryNode) => {
        const parent = parentFromNode(node);
        const kind = (await vscode.window.showQuickPick([...CLASS_KINDS], {
          placeHolder: "Class kind",
          title: parent ? `New class inside ${parent}` : "New top-level class",
        })) as ClassKind | undefined;
        if (!kind) return;
        const name = await vscode.window.showInputBox({
          prompt: parent ? `New ${kind} inside ${parent}` : `New top-level ${kind}`,
          placeHolder: defaultPlaceholder(kind),
          validateInput: validateIdentifier,
        });
        if (!name) return;
        const qualified = parent ? `${parent}.${name}` : name;
        const body = `${kind} ${name}\nend ${name};\n`;
        const data = parent ? `within ${parent};\n${body}` : body;
        await runLoadString(ctx, data, qualified, "Modelica: failed to create");
      },
    ),
  ];
}

function defaultPlaceholder(kind: ClassKind): string {
  return `My${kind[0]!.toUpperCase()}${kind.slice(1)}`;
}
