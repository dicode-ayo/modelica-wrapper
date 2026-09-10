import type { DiagramLayout, SourceLocation } from "@dicode/omc-client";

import type { ContextKeys } from "../interaction/context-keys.js";

/**
 * A resolved "open this source" request. The location is OMC-reported
 * (1-based, inclusive end column); the host converts. `fallbackClassName`
 * names the class whose `modelica-source:` view stands in when
 * `source.filename` is not an openable file (e.g. a `loadString`ed class).
 */
export interface GoToSourceRequest {
  source: SourceLocation;
  fallbackClassName: string;
}

/**
 * The diagram surface a command acts on. A structural interface so the host
 * component satisfies it via a small adapter — commands never reach into the
 * component's internals, and tests pass a plain object.
 */
export interface CommandTarget {
  readonly layout: DiagramLayout | null;
  readonly selectedKeys: ReadonlySet<string>;
  /** The vertex wire key (`vtx:<shapeKind>:<shapeIndex>/<vertexIndex>`) a
   *  right-click landed on, for vertex-targeted commands; `null` outside a
   *  vertex context menu. */
  readonly contextVertex: string | null;
  /** Persist a new layout (emits the host's change event). */
  commitLayout(next: DiagramLayout): void;
  /** Replace the current selection. */
  setSelection(keys: Iterable<string>): void;
  /** Delegates a class-swap to the host — commands stay synchronous. */
  requestClassChange?(componentName: string, currentClass: string): void;
  /**
   * Delegates copy/paste to the host, which owns the clipboard. Like the
   * class-swap, the command only reports the gesture; the host resolves the
   * selection and performs the writes.
   */
  requestClipboard?(action: "copy" | "paste"): void;
  /** Delegates opening an entity's source to the host, which owns editors. */
  requestGoToSource?(request: GoToSourceRequest): void;
  /** Opens the keyboard-shortcuts help dialog. */
  showKeymapHelp?(): void;
}

/** A UI surface a command can be placed on. */
export type CommandSurface = "contextMenu" | "toolbar" | "actionMenu";

/**
 * Declares that a command appears on a {@link CommandSurface}. `group` + `order`
 * position it within that surface (separators fall between groups); `when`
 * gates its visibility there, falling back to the command's own `when`.
 */
export interface CommandPlacement {
  surface: CommandSurface;
  group?: string;
  order?: number;
  when?: (ctx: ContextKeys) => boolean;
}

/** A command resolved to one of its placements on a surface. */
export interface PlacedCommand<Id extends string = string> {
  command: Command<Id>;
  placement: CommandPlacement;
}

/**
 * A single user-invokable diagram action. `when` gates availability against
 * the derived {@link ContextKeys} (selection, mode, readonly, …); `run`
 * performs the mutation through the {@link CommandTarget}. The same command is
 * the single source for the keymap, the action-panel buttons, and every
 * surface it's `placements`-ed on.
 *
 * `Id` narrows `id` to a known-command union (e.g. `DiagramCommandId`) so the
 * keymap and every `run`/`isEnabled` call site is typo-checked; it defaults to
 * `string` for ad-hoc commands.
 */
export interface Command<Id extends string = string> {
  id: Id;
  title: string;
  category: string;
  icon?: string;
  when?: (ctx: ContextKeys) => boolean;
  placements?: readonly CommandPlacement[];
  run: (target: CommandTarget) => void;
}
