/**
 * Extension-host (CommonJS) parser for the diagram-ui entity-key wire
 * format. Mirrors the SHAPE of `@modelica-wrapper/diagram-ui`'s
 * `node-keys.ts` — same prefixes, same nodeId conventions — but lives
 * here as a small standalone module because the extension host can't
 * import the ESM-only diagram-ui package directly (same constraint
 * `webview/protocol.ts` documents for `LibraryClassRestriction`).
 *
 * Keep the two in sync if either side ever introduces new kinds. The
 * wire prefixes are listed in `KIND_PREFIX` below — if you add one in
 * `diagram-ui/src/interaction/node-keys.ts`, add it here too and add
 * a corresponding type guard.
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

interface SimpleKey<K extends EntityKind> {
  kind: K;
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
  /** Owning sub-component, or `null` for standalone connectors on the host class. */
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

export function formatEntityKey(kind: EntityKind, nodeId: string): string {
  return `${KIND_PREFIX[kind]}:${nodeId}`;
}

export function parseEntityKey(key: string): EntityKey | null {
  const idx = key.indexOf(":");
  if (idx < 0) return null;
  const prefix = key.slice(0, idx);
  const kind = PREFIX_KIND[prefix];
  if (!kind) return null;
  const nodeId = key.slice(idx + 1);
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
