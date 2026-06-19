import type { ContextKeys } from "../interaction/context-keys.js";
import type { Command, CommandTarget } from "./command.js";

/**
 * Holds the diagram {@link Command} set and resolves an id to a run, gated by
 * the command's `when` predicate. One registry instance backs every surface
 * that invokes commands — the keymap, the action-panel buttons, and (later)
 * the context menu and keymap-help view — so they can never drift.
 */
export class CommandRegistry {
  private readonly byId = new Map<string, Command>();

  constructor(commands: Iterable<Command> = []) {
    for (const command of commands) {
      this.register(command);
    }
  }

  register(command: Command): void {
    if (this.byId.has(command.id)) {
      throw new Error(`CommandRegistry: duplicate command id '${command.id}'`);
    }
    this.byId.set(command.id, command);
  }

  get(id: string): Command | undefined {
    return this.byId.get(id);
  }

  all(): readonly Command[] {
    return [...this.byId.values()];
  }

  /** Whether `id` exists and its `when` predicate (if any) holds for `ctx`. */
  isEnabled(id: string, ctx: ContextKeys): boolean {
    const command = this.byId.get(id);
    if (!command) {
      return false;
    }
    return command.when ? command.when(ctx) : true;
  }

  /**
   * Run the command if it exists and is enabled for `ctx`. Returns whether it
   * fired, so callers can decide whether to consume the originating event.
   */
  run(id: string, ctx: ContextKeys, target: CommandTarget): boolean {
    const command = this.byId.get(id);
    if (!command || (command.when && !command.when(ctx))) {
      return false;
    }
    command.run(target);
    return true;
  }
}
