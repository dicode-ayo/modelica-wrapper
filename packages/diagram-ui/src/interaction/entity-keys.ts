/**
 * Canonical key format for diagram entities. Mirrors dyad-ui's short
 * prefixes so the host element + interaction layer can identify what
 * was clicked / hovered / selected by a single string.
 *
 * Wire form: `<prefix>:<nodeId>` (e.g. `c:R1`, `k:p`, `k:R1.p`). The
 * decoded shape is a discriminated union on `kind`, so consumers can
 * `switch` on `key.kind` and TS will narrow each branch automatically —
 * no `as` casts, no hand-written type guards to keep in step.
 *
 * Kinds whose `nodeId` is compound (connector, shape, junction, vertex
 * handle) arrive decomposed, so consumers stop redoing the `indexOf(".")`
 * / `indexOf("/")` dance at every call site.
 *
 * Published as the `@dicode/diagram-ui/entity-keys` subpath so the
 * extension host shares this parser instead of mirroring it. Import
 * nothing here: the package root pulls in the Lit and Pixi component tree,
 * whose types need the DOM lib the host's Node program does not have.
 */

/**
 * Wire prefix per kind. This declaration is the single edit that introduces
 * a kind — `EntityKind`, the `EntityKey` union and the parse table all
 * derive from it.
 */
const KIND_PREFIX = {
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
} as const;

export type EntityKind = keyof typeof KIND_PREFIX;

const PREFIX_KIND: Record<string, EntityKind> = Object.fromEntries(
  Object.entries(KIND_PREFIX).map(([kind, prefix]) => [
    prefix,
    kind as EntityKind,
  ]),
);

/**
 * The decoded fields a compound `nodeId` carries. A kind absent from this
 * map decodes to `{ kind, nodeId }` alone; adding an entry here without
 * teaching {@link makeKey} to produce it is a compile error.
 */
interface KindFields {
  connector: {
    /**
     * Owning sub-component's instance name. `null` for standalone
     * connectors declared directly on the host class.
     */
    componentName: string | null;
    /** Local port name within its owning class. */
    portName: string;
  };
  shape: {
    /** Primitive kind: `rectangle` / `ellipse` / `line` / `polygon` / `text` / `bitmap`. */
    shapeKind: string;
    /** Position in the host's own-layer (`from === className`) shape array. */
    index: number;
  };
  junction: {
    /** Index of the connection the waypoint belongs to. */
    connIndex: number;
    /** Position of the waypoint within that connection's route. */
    waypointIndex: number;
  };
  "vertex-handle": {
    shapeKind: string;
    shapeIndex: number;
    vertexIndex: number;
  };
}

/** The decoded key for a single kind. `nodeId` is the raw id portion of the
 *  wire key (everything after `<prefix>:`). */
export type KeyOf<K extends EntityKind> = {
  kind: K;
  nodeId: string;
} & (K extends keyof KindFields ? KindFields[K] : unknown);

export type EntityKey = { [K in EntityKind]: KeyOf<K> }[EntityKind];

export type ConnectorKey = KeyOf<"connector">;
export type ShapeKey = KeyOf<"shape">;
export type JunctionKey = KeyOf<"junction">;
/**
 * A single vertex of a poly shape — self-describing, so a dragged or
 * right-clicked dot carries its full identity without re-deriving the owner.
 * Raw id: `${shapeKind}:${shapeIndex}/${vertexIndex}` (e.g. `line:1/2`),
 * mirroring the junction key's `<owner>/<index>` shape.
 */
export type VertexHandleKey = KeyOf<"vertex-handle">;

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
  return makeKey(kind, key.slice(idx + 1));
}

/**
 * Decode a kind + raw id pair that did not arrive over the wire — the
 * scene-graph tag carries the two separately.
 */
export function makeKey(kind: EntityKind, nodeId: string): EntityKey {
  switch (kind) {
    case "connector": {
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
    case "shape": {
      const { shapeKind, index } = parseShapeId(nodeId);
      return { kind, nodeId, shapeKind, index };
    }
    case "junction": {
      const [connId, waypointId] = splitCompoundId(nodeId, nodeId.indexOf("/"));
      return {
        kind,
        nodeId,
        connIndex: failClosedIndex(connId),
        waypointIndex: failClosedIndex(waypointId),
      };
    }
    case "vertex-handle": {
      const [shapeId, vertexId] = splitCompoundId(
        nodeId,
        nodeId.lastIndexOf("/"),
      );
      const { shapeKind, index: shapeIndex } = parseShapeId(shapeId);
      return {
        kind,
        nodeId,
        shapeKind,
        shapeIndex,
        vertexIndex: failClosedIndex(vertexId),
      };
    }
    default:
      return { kind, nodeId };
  }
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
 * Split an `<owner>/<index>` id at `slash`. A missing separator yields the
 * whole id as the owner and an empty index, which {@link failClosedIndex}
 * turns into `NaN`.
 */
function splitCompoundId(id: string, slash: number): [string, string] {
  return slash < 0 ? [id, ""] : [id.slice(0, slash), id.slice(slash + 1)];
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

/** True when the connector belongs to a sub-component (vs. the host class). */
export function isNestedConnector(key: ConnectorKey): boolean {
  return key.componentName !== null;
}
