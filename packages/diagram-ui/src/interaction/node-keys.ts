import type { Node } from "@babylonjs/core";

/**
 * Canonical key format for diagram entities. Mirrors dyad-ui's short
 * prefixes so the host element + interaction layer can identify what
 * was clicked / hovered / selected by a single string.
 */
export type EntityKind =
  | "component"
  | "connector"
  | "edge"
  | "junction"
  | "label"
  | "port"
  | "handle";

const KIND_PREFIX: Record<EntityKind, string> = {
  component: "c",
  connector: "k",
  edge: "edge",
  junction: "junc",
  label: "lbl",
  port: "port",
  handle: "h",
};

const PREFIX_KIND: Record<string, EntityKind> = Object.fromEntries(
  Object.entries(KIND_PREFIX).map(([k, v]) => [v, k as EntityKind]),
);

const KIND_BABYLON_NAME: Record<EntityKind, string> = {
  component: "om-component",
  connector: "om-connector",
  edge: "om-edge",
  junction: "om-junction",
  label: "om-label",
  port: "om-port",
  handle: "om-handle",
};

export interface EntityKey {
  kind: EntityKind;
  nodeId: string;
}

export function formatKey(kind: EntityKind, nodeId: string): string {
  return `${KIND_PREFIX[kind]}:${nodeId}`;
}

export function parseKey(key: string): EntityKey | null {
  const idx = key.indexOf(":");
  if (idx < 0) {
    return null;
  }
  const prefix = key.slice(0, idx);
  const kind = PREFIX_KIND[prefix];
  if (!kind) {
    return null;
  }
  return { kind, nodeId: key.slice(idx + 1) };
}

/**
 * Walks `node`'s parent chain looking for the first ancestor that
 * advertises an entity identity, either through:
 *
 *   - `metadata: { kind, nodeId }`   — set explicitly by elements that
 *     don't carry their identity in the Babylon node name (edges,
 *     junctions, port indicators)
 *
 *   - `name: "om-<kind>:<id>"`        — set by `OmShapeNode` /
 *     `<om-label>` for entities whose TransformNode owns the identity
 *
 * Nested connectors (a `<om-connector>` inside an `<om-component>`)
 * are disambiguated by composing the parent component's id into the
 * key: `om-connector:p` inside `om-component:R1` yields
 * `{kind: "connector", nodeId: "R1.p"}`. Without this, two components
 * each with a port `p` collide on `k:p` and the host element can't
 * tell which one the user clicked.
 */
export function entityKeyForNode(start: Node | null): EntityKey | null {
  let cur: Node | null = start;
  let pendingConnector: string | null = null;
  while (cur) {
    const meta = cur.metadata as
      | { kind?: string; nodeId?: string }
      | null
      | undefined;
    if (meta && typeof meta.kind === "string") {
      const kind = meta.kind as EntityKind;
      if (KIND_BABYLON_NAME[kind]) {
        return { kind, nodeId: meta.nodeId ?? "" };
      }
    }
    const m = cur.name?.match(/^om-(component|connector|label):(.*)$/);
    if (m) {
      const kind = m[1] as EntityKind;
      const id = m[2] ?? "";
      if (kind === "connector" && pendingConnector === null) {
        // Keep walking — a connector might be nested inside a
        // component, in which case we want the qualified key.
        pendingConnector = id;
      } else if (kind === "component" && pendingConnector !== null) {
        return { kind: "connector", nodeId: `${id}.${pendingConnector}` };
      } else {
        return { kind, nodeId: id };
      }
    }
    cur = cur.parent;
  }
  if (pendingConnector !== null) {
    return { kind: "connector", nodeId: pendingConnector };
  }
  return null;
}
