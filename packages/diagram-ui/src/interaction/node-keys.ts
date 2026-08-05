import type { Container } from "pixi.js";

import { makeKey, type EntityKey, type EntityKind } from "./entity-keys.js";

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

/** Drop a container's entity tag so it resolves identity via an ancestor. */
export function clearEntityTag(container: Container): void {
  entityMeta.delete(container);
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
