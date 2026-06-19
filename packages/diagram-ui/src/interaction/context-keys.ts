import type { InteractionSnapshot, ModeId } from "./interaction-state.js";
import { parseKey, type EntityKind } from "./node-keys.js";

/**
 * Context keys derived from the interaction snapshot plus host
 * environment. Commands gate their availability on these (the `when`
 * predicate), so the same key or click resolves differently depending on
 * the active mode, the current gesture, and what is selected.
 */

/** Homogeneous selection reports its entity kind; a mixed selection
 *  reports `"mixed"`; an empty one `"none"`. */
export type SelectionKind = EntityKind | "none" | "mixed";

/** Host-supplied context the snapshot can't carry on its own. */
export interface ContextEnv {
  readonly: boolean;
  viewLayer: "icon" | "diagram";
  hasClipboard: boolean;
}

export interface ContextKeys {
  mode: ModeId;
  gesture: InteractionSnapshot["state"]["kind"];
  selectionKind: SelectionKind;
  selectionCount: number;
  readonly: boolean;
  viewLayer: "icon" | "diagram";
  hasClipboard: boolean;
}

export function deriveContextKeys(
  snapshot: InteractionSnapshot,
  env: ContextEnv,
): ContextKeys {
  const keys = snapshot.selectedKeys;
  return {
    mode: snapshot.mode,
    gesture: snapshot.state.kind,
    selectionKind: selectionKindOf(keys),
    selectionCount: keys.length,
    readonly: env.readonly,
    viewLayer: env.viewLayer,
    hasClipboard: env.hasClipboard,
  };
}

function selectionKindOf(keys: readonly string[]): SelectionKind {
  let kind: EntityKind | null = null;
  for (const k of keys) {
    const parsed = parseKey(k);
    if (!parsed) {
      continue;
    }
    if (kind === null) {
      kind = parsed.kind;
    } else if (kind !== parsed.kind) {
      return "mixed";
    }
  }
  return kind ?? "none";
}
