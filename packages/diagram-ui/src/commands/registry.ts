import type { ContextKeys } from "../interaction/context-keys.js";
import type {
  Command,
  CommandSurface,
  CommandTarget,
  PlacedCommand,
} from "./command.js";

/**
 * Holds the diagram {@link Command} set and resolves an id to a run, gated by
 * the command's `when` predicate. One registry instance backs every surface
 * that invokes commands — the keymap, the action-panel buttons, the context
 * menu, and the keymap-help view — so they can never drift.
 */
export class CommandRegistry<Id extends string = string> {
  private readonly byId = new Map<Id, Command<Id>>();

  constructor(commands: Iterable<Command<Id>> = []) {
    for (const command of commands) {
      this.register(command);
    }
  }

  register(command: Command<Id>): void {
    if (this.byId.has(command.id)) {
      throw new Error(`CommandRegistry: duplicate command id '${command.id}'`);
    }
    this.byId.set(command.id, command);
  }

  get(id: Id): Command<Id> | undefined {
    return this.byId.get(id);
  }

  all(): readonly Command<Id>[] {
    return [...this.byId.values()];
  }

  /** Whether `id` exists and its `when` predicate (if any) holds for `ctx`. */
  isEnabled(id: Id, ctx: ContextKeys): boolean {
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
  run(id: Id, ctx: ContextKeys, target: CommandTarget): boolean {
    const command = this.byId.get(id);
    if (!command || (command.when && !command.when(ctx))) {
      return false;
    }
    command.run(target);
    return true;
  }

  /**
   * Commands placed on `surface` whose placement is visible for `ctx` (the
   * placement's `when`, else the command's `when`, else always), ordered by
   * group then `order`. Each result carries its resolved `placement` so the
   * view can draw separators between groups without re-matching the surface.
   */
  commandsFor(
    surface: CommandSurface,
    ctx: ContextKeys,
  ): readonly PlacedCommand<Id>[] {
    const matched: PlacedCommand<Id>[] = [];
    for (const command of this.byId.values()) {
      for (const placement of command.placements ?? []) {
        if (placement.surface !== surface) {
          continue;
        }
        const visible = placement.when ?? command.when;
        if (visible && !visible(ctx)) {
          continue;
        }
        matched.push({ command, placement });
      }
    }
    matched.sort((a, b) => {
      // `group` is a structural token, not display text — pin the locale so
      // the order doesn't depend on the host's.
      const group = (a.placement.group ?? "").localeCompare(
        b.placement.group ?? "",
        "en",
      );
      return group !== 0
        ? group
        : (a.placement.order ?? 0) - (b.placement.order ?? 0);
    });
    return matched;
  }
}
