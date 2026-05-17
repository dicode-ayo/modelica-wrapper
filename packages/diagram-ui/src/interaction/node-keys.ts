import type { Node } from "@babylonjs/core";

/**
 * Canonical key format for diagram entities. Mirrors dyad-ui's short
 * prefixes so the host element + interaction layer can identify what
 * was clicked / hovered / selected by a single string.
 *
 * Wire form: `<prefix>:<nodeId>` (e.g. `c:R1`, `k:p`, `k:R1.p`). The
 * decoded shape is a discriminated union on `kind`, so consumers can
 * `switch` / use the `isXxxKey` type guards and TS will narrow each
 * branch automatically — no `as` casts.
 *
 * `ConnectorKey` carries the decomposed `componentName` (owner) and
 * `portName` (local) directly, so consumers stop redoing the
 * `nodeId.indexOf(".")` dance at every call site.
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

/** All non-connector kinds share this flat shape. */
interface SimpleKey<K extends EntityKind> {
  kind: K;
  /** Raw id portion of the wire key (everything after `<prefix>:`). */
  nodeId: string;
}

export type ComponentKey = SimpleKey<"component">;
export type EdgeKey = SimpleKey<"edge">;
export type JunctionKey = SimpleKey<"junction">;
export type LabelKey = SimpleKey<"label">;
export type PortKey = SimpleKey<"port">;
export type HandleKey = SimpleKey<"handle">;

export interface ConnectorKey {
  kind: "connector";
  /** Raw id — `${componentName}.${portName}` for nested, `portName` for standalone. */
  nodeId: string;
  /**
   * Owning sub-component's instance name. `null` for standalone
   * connectors declared directly on the host class.
   */
  componentName: string | null;
  /** Local port name within its owning class. */
  portName: string;
}

export type EntityKey =
  | ComponentKey
  | ConnectorKey
  | EdgeKey
  | JunctionKey
  | LabelKey
  | PortKey
  | HandleKey;

// ── Format ───────────────────────────────────────────────────────────

export function formatKey(kind: EntityKind, nodeId: string): string {
  return `${KIND_PREFIX[kind]}:${nodeId}`;
}

export function formatComponentKey(componentName: string): string {
  return formatKey("component", componentName);
}

/**
 * Build a connector wire key from its decomposed parts. Pass `null` for
 * `componentName` to address a standalone connector on the host class;
 * any other value qualifies the port as `${componentName}.${portName}`.
 */
export function formatConnectorKey(
  componentName: string | null,
  portName: string,
): string {
  return formatKey(
    "connector",
    componentName === null ? portName : `${componentName}.${portName}`,
  );
}

// ── Parse ────────────────────────────────────────────────────────────

export function parseKey(key: string): EntityKey | null {
  const idx = key.indexOf(":");
  if (idx < 0) return null;
  const prefix = key.slice(0, idx);
  const kind = PREFIX_KIND[prefix];
  if (!kind) return null;
  const nodeId = key.slice(idx + 1);
  return makeKey(kind, nodeId);
}

/**
 * Internal constructor that decomposes connector ids into
 * `componentName` / `portName`. Kept private — call sites should go
 * through `parseKey` / `formatConnectorKey` instead.
 */
function makeKey(kind: EntityKind, nodeId: string): EntityKey {
  if (kind === "connector") {
    const dot = nodeId.indexOf(".");
    if (dot < 0) {
      return { kind, nodeId, componentName: null, portName: nodeId };
    }
    return {
      kind,
      nodeId,
      componentName: nodeId.slice(0, dot),
      portName: nodeId.slice(dot + 1),
    };
  }
  return { kind, nodeId } as EntityKey;
}

// ── Type guards ──────────────────────────────────────────────────────

export function isComponentKey(key: EntityKey): key is ComponentKey {
  return key.kind === "component";
}

export function isConnectorKey(key: EntityKey): key is ConnectorKey {
  return key.kind === "connector";
}

export function isEdgeKey(key: EntityKey): key is EdgeKey {
  return key.kind === "edge";
}

export function isJunctionKey(key: EntityKey): key is JunctionKey {
  return key.kind === "junction";
}

export function isLabelKey(key: EntityKey): key is LabelKey {
  return key.kind === "label";
}

export function isPortKey(key: EntityKey): key is PortKey {
  return key.kind === "port";
}

export function isHandleKey(key: EntityKey): key is HandleKey {
  return key.kind === "handle";
}

/** True when the connector belongs to a sub-component (vs. the host class). */
export function isNestedConnector(key: ConnectorKey): boolean {
  return key.componentName !== null;
}

// ── Babylon-node walker ──────────────────────────────────────────────

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
 * `{kind: "connector", nodeId: "R1.p", componentName: "R1", portName: "p"}`.
 * Without this, two components each with a port `p` collide on `k:p`
 * and the host element can't tell which one the user clicked.
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
        return makeKey(kind, meta.nodeId ?? "");
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
        return makeKey("connector", `${id}.${pendingConnector}`);
      } else {
        return makeKey(kind, id);
      }
    }
    cur = cur.parent;
  }
  if (pendingConnector !== null) {
    return makeKey("connector", pendingConnector);
  }
  return null;
}
