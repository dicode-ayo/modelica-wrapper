/**
 * Narrows the "Change class" candidate list to classes that keep the
 * component's existing `connect()` equations valid. `setElementType`
 * succeeds either way, so an incompatible swap leaves dangling
 * connections that only surface at the next compile.
 *
 * The ports a swap must preserve come from the already-fetched
 * `DiagramLayout` — `ClassDef.connectors` is inheritance-resolved — so
 * that side costs no OMC call. Candidate ports are resolved with
 * `getElements`, never `getModelInstance`: instantiating a candidate
 * hangs forever on builtins such as `String` and costs seconds on deep
 * models, and OMC serializes every call on one socket, so a single bad
 * candidate stalls the diagram and diagnostics along with the picker.
 */

import type { DiagramLayout, Value } from "@dicode/omc-client";

import { log } from "../logger.js";

import { SearchAbortedError, throwIfAborted } from "./library-source.js";

/** A candidate's public component declarations, keyed by name → type name. */
export type PortMap = ReadonlyMap<string, string>;

/**
 * The identity a swap candidate must reproduce for one connected port.
 *
 * Causality needs no separate field: Modelica bakes it into the connector
 * type, so `RealInput` and `RealOutput` are distinct `typeName`s. Matching
 * the type therefore matches the direction, and `getElements` — which
 * reports a component's declared type but not the causality of the
 * connector class behind it — can still answer the question.
 */
export interface ConnectedPortProfile {
  name: string;
  typeName: string;
}

/**
 * Profiles of every port `componentName` currently has wired up in
 * `layout`. Empty when the component has no connections (nothing to
 * preserve) or its port shapes are unresolved — requiring nothing beats
 * blocking every candidate.
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
    profiles.push({ name: port.name, typeName: port.typeName });
  }
  return profiles;
}

/**
 * True when `candidatePorts` reproduces every entry in `required`.
 *
 * The type match is exact, not subtype-aware: a candidate whose port is
 * typed on a base or sibling connector that Modelica would still accept
 * is rejected. The error is one-directional — a valid candidate can be
 * hidden, an invalid one is never kept — which keeps the swap safe at the
 * cost of occasionally under-offering.
 */
export function candidateCoversPorts(
  candidatePorts: PortMap,
  required: readonly ConnectedPortProfile[],
): boolean {
  return required.every(
    (port) => candidatePorts.get(port.name) === port.typeName,
  );
}

/** Column offsets into a `getElements` row. */
const ROW_KIND = 0;
const ROW_TYPE = 2;
const ROW_NAME = 3;
const ROW_VISIBILITY = 5;

function identName(v: Value | undefined): string | undefined {
  return v?.kind === "ident" ? v.name : undefined;
}

function stringValue(v: Value | undefined): string | undefined {
  return v?.kind === "string" ? v.value : undefined;
}

/**
 * The public components a `getElements` payload declares, keyed by name.
 *
 * Rows are positional and their arity varies across OMC versions, so
 * anything that doesn't present a `"co"` kind with an identifier type and
 * name is skipped rather than trusted. Only an explicit `"protected"`
 * marker drops a component — a connection from the enclosing class can't
 * reference one — so an OMC build that omits the visibility field keeps
 * the ports rather than dropping every candidate's connectors.
 */
export function declaredComponentsOf(elements: Value): Map<string, string> {
  const components = new Map<string, string>();
  if (elements.kind !== "list") return components;
  for (const row of elements.items) {
    if (row.kind !== "list") continue;
    const { items } = row;
    if (stringValue(items[ROW_KIND]) !== "co") continue;
    if (stringValue(items[ROW_VISIBILITY]) === "protected") continue;
    const typeName = identName(items[ROW_TYPE]);
    const name = identName(items[ROW_NAME]);
    if (typeName === undefined || name === undefined) continue;
    components.set(name, typeName);
  }
  return components;
}

/** The OMC surface the candidate walk needs. `OmcClient` satisfies it. */
export interface CandidateElementsClient {
  getElements(input: { typeName: string }): Promise<{ elements: Value }>;
  getInheritedClasses(input: {
    typeName: string;
  }): Promise<{ inheritedClasses: string[] }>;
}

/** Successfully resolved port maps, shared across candidates and queries. */
export type PortMapCache = Map<string, PortMap>;

/**
 * Every public component `className` exposes, its own and its ancestors'.
 *
 * `getElements` reports only locally-declared elements and omits `extends`
 * rows entirely, so the inheritance chain has to be walked explicitly:
 * a `Resistor`'s `p`/`n` live on `OnePort`'s base `TwoPin`, three levels
 * up. Bases are shared across candidates, so the cache absorbs most of
 * the cost after the first few.
 *
 * `undefined` means "couldn't resolve" (parse error, class not found,
 * transport hiccup), and callers keep the candidate rather than hide it
 * on an error unrelated to actual incompatibility. Failures aren't
 * cached — a later attempt may succeed once more libraries load.
 */
export function resolveCandidatePorts(
  client: CandidateElementsClient,
  className: string,
  cache: PortMapCache,
  signal?: AbortSignal,
): Promise<PortMap | undefined> {
  return resolvePorts(client, className, cache, signal, new Set());
}

async function resolvePorts(
  client: CandidateElementsClient,
  className: string,
  cache: PortMapCache,
  signal: AbortSignal | undefined,
  pending: Set<string>,
): Promise<PortMap | undefined> {
  const cached = cache.get(className);
  if (cached) return cached;
  // OMC rejects cyclic `extends`, but a malformed on-disk library can
  // still present one; treat the back-edge as contributing nothing.
  if (pending.has(className)) return new Map();
  pending.add(className);
  try {
    throwIfAborted(signal);
    const { elements } = await client.getElements({ typeName: className });
    throwIfAborted(signal);
    const { inheritedClasses } = await client.getInheritedClasses({
      typeName: className,
    });
    const ports = new Map<string, string>();
    for (const base of inheritedClasses) {
      const inherited = await resolvePorts(
        client,
        base,
        cache,
        signal,
        pending,
      );
      if (inherited === undefined) return undefined;
      for (const [name, typeName] of inherited) ports.set(name, typeName);
    }
    // A local declaration shadows the inherited one of the same name.
    for (const [name, typeName] of declaredComponentsOf(elements)) {
      ports.set(name, typeName);
    }
    cache.set(className, ports);
    return ports;
  } catch (err) {
    if (err instanceof SearchAbortedError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    log.debug("changeClassPorts", `resolving ${className} failed: ${message}`);
    return undefined;
  } finally {
    pending.delete(className);
  }
}

/**
 * Keep the candidates that can carry `required`. Resolution is sequential
 * because OMC serializes anyway, which lets an abort drop the queued
 * remainder instead of paying for a superseded keystroke. An empty
 * `required` skips OMC entirely — the common case of an unconnected
 * component.
 *
 * Throws `SearchAbortedError` once `signal` aborts.
 */
export async function filterCompatibleCandidates<
  T extends { qualified: string },
>(
  client: CandidateElementsClient,
  candidates: readonly T[],
  required: readonly ConnectedPortProfile[],
  cache: PortMapCache,
  signal?: AbortSignal,
): Promise<T[]> {
  if (required.length === 0) return [...candidates];
  const compatible: T[] = [];
  for (const candidate of candidates) {
    throwIfAborted(signal);
    const ports = await resolveCandidatePorts(
      client,
      candidate.qualified,
      cache,
      signal,
    );
    if (ports === undefined || candidateCoversPorts(ports, required)) {
      compatible.push(candidate);
    }
  }
  return compatible;
}
