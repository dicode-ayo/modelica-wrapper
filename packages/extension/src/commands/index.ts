/**
 * Single entry point for `extension.ts` to wire every command. Each per-domain
 * module returns its `Disposable`s; we flatten them so the caller can splat
 * into `context.subscriptions.push(...)`.
 */

import type * as vscode from "vscode";

import { registerComponentCommands } from "./component.js";
import { registerDiagramCommands } from "./diagram.js";
import { registerLibraryCommands } from "./library.js";
import { registerOmcCommands } from "./omc.js";
import { registerPackageCommands } from "./package.js";
import { registerTreeCommands } from "./tree.js";

import type { CommandContext } from "./context.js";

export type { CommandContext } from "./context.js";

export function registerCommands(ctx: CommandContext): vscode.Disposable[] {
  return [
    ...registerOmcCommands(ctx),
    ...registerLibraryCommands(ctx),
    ...registerTreeCommands(ctx),
    ...registerPackageCommands(ctx),
    ...registerComponentCommands(ctx),
    ...registerDiagramCommands(ctx),
  ];
}
