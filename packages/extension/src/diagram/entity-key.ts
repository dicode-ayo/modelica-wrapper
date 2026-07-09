/**
 * Extension-host (CommonJS) parser for the diagram-ui entity-key wire
 * format. Mirrors the SHAPE of `@dicode/diagram-ui`'s
 * `node-keys.ts` — same prefixes, same nodeId conventions — but lives
 * here as a small standalone module because the extension host can't
 * import the ESM-only diagram-ui package directly.
 *
 * Keep the two in sync if either side ever introduces new kinds. The
 * wire prefixes are listed in `KIND_PREFIX` below — if you add one in
 * `diagram-ui/src/interaction/node-keys.ts`, add it here too and add
 * a corresponding type guard.
 */

export type EntityKind =
  | "component"
  | "connector"
  | "shape"
  | "edge"
  | "junction"
  | "label"
  | "port"
  | "handle";

const KIND_PREFIX: Record<EntityKind, string> = {
  component: "c",
  connector: "k",
  shape: "shape",
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

export interface ShapeKey {
  kind: "shape";
  /** Raw id — `${shapeKind}:${index}` (e.g. `rectangle:3`). */
  nodeId: string;
  /** Primitive kind: `rectangle` / `ellipse` / `line` / `polygon` / `text` / `bitmap`. */
  shapeKind: string;
  /** Index in the host's own-layer shape array. */
  index: number;
}

export type EntityKey =
  | ComponentKey
  | ConnectorKey
  | ShapeKey
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
  if (kind === "shape") {
    const colon = nodeId.lastIndexOf(":");
    const shapeKind = colon < 0 ? nodeId : nodeId.slice(0, colon);
    const indexStr = colon < 0 ? "" : nodeId.slice(colon + 1);
    const n = Number(indexStr);
    const index = indexStr !== "" && Number.isInteger(n) ? n : NaN;
    return { kind, nodeId, shapeKind, index };
  }
  return { kind, nodeId } as EntityKey;
}

export function isComponentKey(key: EntityKey): key is ComponentKey {
  return key.kind === "component";
}

export function isConnectorKey(key: EntityKey): key is ConnectorKey {
  return key.kind === "connector";
}

export function isShapeKey(key: EntityKey): key is ShapeKey {
  return key.kind === "shape";
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
