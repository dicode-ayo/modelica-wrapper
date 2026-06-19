import type { DiagramLayout } from "@dicode/omc-client";

import type { ContextKeys } from "../interaction/context-keys.js";

/**
 * The diagram surface a command acts on. A structural interface so the host
 * component satisfies it via a small adapter — commands never reach into the
 * component's internals, and tests pass a plain object.
 */
export interface CommandTarget {
  readonly layout: DiagramLayout | null;
  readonly selectedKeys: ReadonlySet<string>;
  /** Persist a new layout (emits the host's change event). */
  commitLayout(next: DiagramLayout): void;
  /** Replace the current selection. */
  setSelection(keys: Iterable<string>): void;
}

/**
 * A single user-invokable diagram action. `when` gates availability against
 * the derived {@link ContextKeys} (selection, mode, readonly, …); `run`
 * performs the mutation through the {@link CommandTarget}. The same command is
 * the single source for both the keymap and the action-panel buttons.
 */
export interface Command {
  id: string;
  title: string;
  category: string;
  icon?: string;
  when?: (ctx: ContextKeys) => boolean;
  run: (target: CommandTarget) => void;
}
