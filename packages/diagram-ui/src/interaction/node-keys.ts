import type { Container } from "pixi.js";

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
  | "shape"
  | "edge"
  | "junction"
  | "label"
  | "port"
  | "handle"
  | "rotate-handle"
  | "vertex-handle";

const KIND_PREFIX: Record<EntityKind, string> = {
  component: "c",
  connector: "k",
  shape: "shape",
  edge: "edge",
  junction: "junc",
  label: "lbl",
  port: "port",
  handle: "h",
  "rotate-handle": "rot",
  "vertex-handle": "vtx",
};

const PREFIX_KIND: Record<string, EntityKind> = Object.fromEntries(
  Object.entries(KIND_PREFIX).map(([k, v]) => [v, k as EntityKind]),
);

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
export type RotateHandleKey = SimpleKey<"rotate-handle">;

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

export interface ShapeKey {
  kind: "shape";
  /** Raw id — `${shapeKind}:${index}` (e.g. `rectangle:3`). */
  nodeId: string;
  /** Primitive kind: `rectangle` / `ellipse` / `line` / `polygon` / `text` / `bitmap`. */
  shapeKind: string;
  /** Position in the host's own-layer (`from === className`) shape array. */
  index: number;
}

/**
 * A single vertex of a poly shape — self-describing, so a dragged or
 * right-clicked dot carries its full identity without re-deriving the owner.
 * Raw id: `${shapeKind}:${shapeIndex}/${vertexIndex}` (e.g. `line:1/2`),
 * mirroring the junction key's `<owner>/<index>` shape.
 */
export interface VertexHandleKey {
  kind: "vertex-handle";
  nodeId: string;
  shapeKind: string;
  shapeIndex: number;
  vertexIndex: number;
}

export type EntityKey =
  | ComponentKey
  | ConnectorKey
  | ShapeKey
  | EdgeKey
  | JunctionKey
  | LabelKey
  | PortKey
  | HandleKey
  | RotateHandleKey
  | VertexHandleKey;

// ── Format ───────────────────────────────────────────────────────────

export function formatKey(kind: EntityKind, nodeId: string): string {
  return `${KIND_PREFIX[kind]}:${nodeId}`;
}

export function formatComponentKey(componentName: string): string {
  return formatKey("component", componentName);
}

/** Build a shape wire key from its primitive kind and own-layer index. */
export function formatShapeKey(shapeKind: string, index: number): string {
  return formatKey("shape", `${shapeKind}:${index}`);
}

/** Build a vertex wire key from its owning shape and the vertex's position. */
export function formatVertexKey(
  shapeKind: string,
  shapeIndex: number,
  vertexIndex: number,
): string {
  return formatKey(
    "vertex-handle",
    `${shapeKind}:${shapeIndex}/${vertexIndex}`,
  );
}

/** The shape wire key owning a vertex — `shape:<shapeKind>:<shapeIndex>`. */
export function vertexShapeKey(vertex: VertexHandleKey): string {
  return formatShapeKey(vertex.shapeKind, vertex.shapeIndex);
}

/** A picked entity → its vertex wire key, or `null` unless it's a
 *  well-formed vertex handle (integer shape + vertex indices). */
export function vertexKeyForEntity(entity: EntityKey): string | null {
  if (
    entity.kind !== "vertex-handle" ||
    !Number.isInteger(entity.shapeIndex) ||
    !Number.isInteger(entity.vertexIndex)
  ) {
    return null;
  }
  return formatVertexKey(
    entity.shapeKind,
    entity.shapeIndex,
    entity.vertexIndex,
  );
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
  if (kind === "shape") {
    const { shapeKind, index } = parseShapeId(nodeId);
    return { kind, nodeId, shapeKind, index };
  }
  if (kind === "vertex-handle") {
    const slash = nodeId.lastIndexOf("/");
    const shapeId = slash < 0 ? nodeId : nodeId.slice(0, slash);
    const { shapeKind, index: shapeIndex } = parseShapeId(shapeId);
    return {
      kind,
      nodeId,
      shapeKind,
      shapeIndex,
      vertexIndex: slash < 0 ? NaN : failClosedIndex(nodeId.slice(slash + 1)),
    };
  }
  return { kind, nodeId } as EntityKey;
}

/** Decompose a shape id `${shapeKind}:${index}` (e.g. `line:1`). */
function parseShapeId(id: string): { shapeKind: string; index: number } {
  const colon = id.lastIndexOf(":");
  return {
    shapeKind: colon < 0 ? id : id.slice(0, colon),
    index: failClosedIndex(colon < 0 ? "" : id.slice(colon + 1)),
  };
}

/**
 * Parse an index, failing closed to `NaN`. An absent / non-integer index
 * must not confidently address a real slot (`Number("")` is `0`); `NaN`
 * no-ops at the array lookup instead.
 */
function failClosedIndex(raw: string): number {
  const n = Number(raw);
  return raw !== "" && Number.isInteger(n) ? n : NaN;
}

// ── Type guards ──────────────────────────────────────────────────────

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

/** True when the connector belongs to a sub-component (vs. the host class). */
export function isNestedConnector(key: ConnectorKey): boolean {
  return key.componentName !== null;
}

// ── Entity identity side-channel ─────────────────────────────────────

interface EntityMeta {
  kind: EntityKind;
  nodeId: string;
}

/**
 * Identity tag attached to a `Container` out-of-band. A `WeakMap` keeps
 * the renderer scene graph free of app metadata and drops entries when
 * containers are GC'd. Producers (`OmShapeNode`, edges, junctions,
 * ports, labels, handles) call `tagEntity`; `entityKeyForNode` reads it
 * while walking the parent chain.
 */
const entityMeta = new WeakMap<Container, EntityMeta>();

/** Tag a container with its entity identity. Also mirrors the id into
 *  `label` for devtools readability. */
export function tagEntity(
  container: Container,
  kind: EntityKind,
  nodeId: string,
): void {
  entityMeta.set(container, { kind, nodeId });
  container.label = `om-${kind}:${nodeId}`;
}

/** Read a container's own entity tag, or `null` if untagged. */
export function readEntityMeta(container: Container): EntityMeta | null {
  return entityMeta.get(container) ?? null;
}

/**
 * Walks `node`'s parent chain looking for the first ancestor that
 * carries an entity identity (set via `tagEntity`).
 *
 * Nested connectors (a `<om-connector>` inside an `<om-component>`) are
 * disambiguated by composing the parent component's id into the key:
 * a connector `p` inside component `R1` yields
 * `{kind: "connector", nodeId: "R1.p", componentName: "R1", portName: "p"}`.
 * Without this, two components each with a port `p` collide on `k:p` and
 * the host element can't tell which one the user clicked.
 */
export function entityKeyForNode(start: Container | null): EntityKey | null {
  let cur: Container | null = start;
  let pendingConnector: string | null = null;
  while (cur) {
    const meta = entityMeta.get(cur);
    if (meta) {
      const { kind, nodeId } = meta;
      if (kind === "connector" && pendingConnector === null) {
        // Keep walking — a connector might be nested inside a
        // component, in which case we want the qualified key.
        pendingConnector = nodeId;
      } else if (kind === "component" && pendingConnector !== null) {
        return makeKey("connector", `${nodeId}.${pendingConnector}`);
      } else {
        return makeKey(kind, nodeId);
      }
    }
    cur = cur.parent;
  }
  if (pendingConnector !== null) {
    return makeKey("connector", pendingConnector);
  }
  return null;
}
