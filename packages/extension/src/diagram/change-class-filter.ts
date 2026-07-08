/**
 * Connection-compatibility filtering for the "Change class" command
 * (issue #239). Swapping a component's class via `setElementType`
 * succeeds even when the new class doesn't expose the connectors the
 * component's existing `connect()` equations reference — that leaves
 * dangling connections OMC will only catch at the next compile. This
 * narrows the "Change class" candidate list to classes that keep every
 * currently-connected port valid: same name, connector type, and
 * causality (Modelica-pragmatic approach from the issue, not the
 * `constrainedby`-subtype approach — no single OMC call enumerates "all
 * subtypes of C").
 */

import {
  diagram,
  type DiagramLayout,
  type ModelInstance,
  type PortDef,
} from "@dicode/omc-client";

import { log } from "../logger.js";

/** The subset of a connected port's identity a swap candidate must match. */
export interface ConnectedPortProfile {
  name: string;
  typeName: string;
  direction: PortDef["direction"];
  flow: PortDef["flow"];
  stream: PortDef["stream"];
}

/**
 * The connector profile of every port `componentName` currently has wired
 * up in `layout`, read from `layout.classes[componentClass].connectors` —
 * the component's own class was already registered while `layout` was
 * built, so this needs no extra OMC round-trip. Empty when the component
 * has no connections (nothing to preserve) or its port shapes are
 * unresolved (nothing to require, rather than blocking every candidate).
 */
export function connectedPortsOf(
  layout: DiagramLayout,
  componentClass: string,
  componentName: string,
): ConnectedPortProfile[] {
  const portNames = new Set<string>();
  for (const conn of layout.connections) {
    if (conn.lhs.component === componentName) portNames.add(conn.lhs.port);
    if (conn.rhs.component === componentName) portNames.add(conn.rhs.port);
  }
  if (portNames.size === 0) return [];
  const connectors = layout.classes[componentClass]?.connectors ?? {};
  const profiles: ConnectedPortProfile[] = [];
  for (const name of portNames) {
    const port = connectors[name];
    if (!port) continue;
    profiles.push({
      name: port.name,
      typeName: port.typeName,
      direction: port.direction,
      flow: port.flow,
      stream: port.stream,
    });
  }
  return profiles;
}

/**
 * True when `candidateConnectors` exposes a matching port — same name,
 * connector type, and causality — for every entry in `required`. An empty
 * `required` (nothing to preserve) is trivially compatible with any
 * candidate.
 */
export function candidateCoversPorts(
  candidateConnectors: Record<string, PortDef>,
  required: readonly ConnectedPortProfile[],
): boolean {
  return required.every((port) => {
    const candidate = candidateConnectors[port.name];
    return (
      candidate !== undefined &&
      candidate.typeName === port.typeName &&
      candidate.direction === port.direction &&
      candidate.flow === port.flow &&
      candidate.stream === port.stream
    );
  });
}

/** Structural OMC client for the lazy per-candidate connector fetch. */
export interface CandidateConnectorsClient {
  invoke(
    method: "getModelInstance",
    input: { typeName: string },
  ): Promise<{ instance: ModelInstance }>;
}

/**
 * Fetch `qualifiedClassName`'s own connector map. Best-effort, mirroring
 * `libraryIconSvg`: `undefined` on any failure (parse error, class not
 * found, transport hiccup) rather than throwing, so a candidate whose
 * connectors we couldn't resolve stays in the picker instead of
 * disappearing on an OMC error unrelated to actual incompatibility.
 */
export async function fetchCandidateConnectors(
  client: CandidateConnectorsClient,
  qualifiedClassName: string,
): Promise<Record<string, PortDef> | undefined> {
  try {
    const { instance } = await client.invoke("getModelInstance", {
      typeName: qualifiedClassName,
    });
    const layout = diagram.produceDiagramLayout(instance, "icon");
    return layout.classes[qualifiedClassName]?.connectors;
  } catch (err) {
    log.debug(
      "changeClassConnectorFetch",
      `getModelInstance failed for ${qualifiedClassName}`,
      (err as Error).message,
    );
    return undefined;
  }
}

/**
 * Filter `candidates` down to those compatible with `required`. Fetches
 * each candidate's connectors lazily — one `getModelInstance` per
 * candidate over the already-searched, already-capped result set, not the
 * whole library — and caches results in `cache` across repeated calls so
 * re-typing or backspacing a query doesn't re-fetch a class already
 * resolved. `required` empty is a fast path that skips OMC entirely (the
 * common case: a freshly added or unconnected component).
 */
export async function filterCompatibleCandidates<
  T extends { qualified: string },
>(
  client: CandidateConnectorsClient,
  candidates: readonly T[],
  required: readonly ConnectedPortProfile[],
  cache: Map<string, Record<string, PortDef> | undefined>,
): Promise<T[]> {
  if (required.length === 0) return [...candidates];
  const included = await Promise.all(
    candidates.map(async (candidate) => {
      let connectors = cache.get(candidate.qualified);
      if (connectors === undefined && !cache.has(candidate.qualified)) {
        connectors = await fetchCandidateConnectors(
          client,
          candidate.qualified,
        );
        cache.set(candidate.qualified, connectors);
      }
      return (
        connectors === undefined || candidateCoversPorts(connectors, required)
      );
    }),
  );
  return candidates.filter((_candidate, i) => included[i] === true);
}
