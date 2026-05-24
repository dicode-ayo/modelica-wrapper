/**
 * Bulk-clear a sub-component's modifiers in ONE RPC.
 *
 * The per-field submit path (`applyComponentParameterEdits`) writes each
 * dirty parameter individually via `setElementModifierValue(..., expr)`,
 * and an empty `expr` clears one modifier. Resetting a whole component to
 * its type defaults that way costs N calls (one per modifier we know
 * about, plus a `getElementModifierNames` round-trip if we have to
 * enumerate first).
 *
 * `removeElementModifiers(className, componentName, keepRedeclares)` lands
 * at the same OMC state in a single call — the path OMEdit uses in its
 * redeclare / reset flow (`OMCProxy.cpp::removeElementModifiers`). This
 * helper is the thin, vscode-free wrapper around it so call sites
 * (current submit-path "clear all", future "Reset to defaults" button,
 * redeclare flows) share one entry point.
 *
 * `componentName` is the sub-component instance name on `className`
 * (e.g. `gain` in `Sample.gain`). The omc-client wrapper quotes it.
 *
 * Pure of vscode / dom imports — unit-tested with a mock OmcClient.
 */

import type { OmcClient } from "@dicode/omc-client";

export interface ClearComponentModifiersOptions {
  /**
   * When `true`, preserve any `redeclare` modifiers (type substitutions)
   * while clearing parameter values — the "reset values but keep the
   * substituted type" semantics. Defaults to `false` (clear everything).
   */
  keepRedeclares?: boolean;
}

/**
 * Remove every modifier attached to `componentName` on `className` with a
 * single `removeElementModifiers` call.
 *
 * Returns OMC's `success` flag verbatim — the caller decides how to
 * surface a `false` (REPL log, toast, …), matching the per-field path's
 * own error handling.
 */
export async function clearComponentModifiers(
  client: OmcClient,
  className: string,
  componentName: string,
  options: ClearComponentModifiersOptions = {},
): Promise<boolean> {
  const { success } = await client.removeElementModifiers({
    typeName: className,
    componentName,
    keepRedeclares: options.keepRedeclares ?? false,
  });
  return success;
}
