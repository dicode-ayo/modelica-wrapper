import type { PlacedCommand } from "../commands/index.js";
import type { ContextMenuItem } from "./context-menu.component.js";

/**
 * Map registry `commandsFor(...)` output to `<om-context-menu>` items. The
 * placement's `group` carries through so the menu draws separators between
 * groups.
 *
 * No `disabled` is set: `commandsFor` already filters by each command's `when`,
 * so everything here is runnable. The menu's disabled support is for a surface
 * that prefers to gray out unavailable commands rather than hide them.
 */
export function commandsToMenuItems(
  placed: readonly PlacedCommand[],
): ContextMenuItem[] {
  return placed.map((p) => ({
    id: p.command.id,
    label: p.command.title,
    group: p.placement.group,
  }));
}
