import type {
  ConnectionEndpoint,
  DiagramLayout,
  Placement,
  Shape,
} from "@dicode/omc-client";

import {
  offsetExtent,
  offsetPoints,
  offsetShape,
  type ClipboardComponent,
  type ClipboardConnection,
  type ClipboardEntry,
  type ClipboardModifier,
} from "./clipboard.js";
import {
  endpointToCref,
  lineAnnotation,
  placementAnnotation,
  type GraphicsLayer,
} from "./diff-layout.js";
import {
  formatEntityKey,
  isComponentKey,
  isConnectorKey,
  isShapeKey,
  parseEntityKey,
} from "./entity-key.js";
import { firstFreeName, takenNames } from "./open-diagram.js";
import { findHostLayer, lookupHostShape } from "./shape-properties.js";

/** OMC surface the copy path needs: the modifiers authored on a declaration. */
export interface CopyClient {
  getElementModifierNames(input: {
    typeName: string;
    elementName: string;
  }): Promise<{ modifiers: string[] }>;
  getElementModifierValue(input: {
    typeName: string;
    modifier: string;
  }): Promise<{ value: string }>;
}

type MutationResult = { success: boolean; diagnostic?: string | undefined };

/** OMC surface the paste path needs. */
export interface PasteClient {
  addComponent(input: {
    componentName: string;
    componentClass: string;
    intoTypeName: string;
    annotation: string;
  }): Promise<MutationResult>;
  setElementModifierValue(input: {
    typeName: string;
    elementName: string;
    expr: string;
  }): Promise<MutationResult>;
  writeClassGraphics(input: {
    typeName: string;
    layer: GraphicsLayer;
    op: { kind: "add"; shape: Shape };
  }): Promise<MutationResult>;
  addConnection(input: {
    from: string;
    to: string;
    typeName: string;
    annotation: string;
  }): Promise<MutationResult>;
}

/**
 * Resolve `keys` against `layout` into clipboard items, reading each
 * declaration's authored modifiers from OMC.
 *
 * Keys that name nothing copyable — connections, junctions, ports on a
 * sub-component — are skipped: a rubber-band routinely sweeps them up
 * alongside the components the user meant, and refusing the whole copy over
 * one of them would make multi-select copy unusable.
 */
export async function captureClipboardItems(
  client: CopyClient,
  layout: DiagramLayout,
  keys: readonly string[],
): Promise<ClipboardEntry[]> {
  const items: ClipboardEntry[] = [];
  for (const key of keys) {
    const parsed = parseEntityKey(key);
    if (parsed === null) continue;

    if (isComponentKey(parsed)) {
      const component = layout.components[parsed.nodeId];
      if (component === undefined) continue;
      items.push(
        await captureComponent(
          client,
          layout.className,
          parsed.nodeId,
          component.classRef,
          component.placement,
        ),
      );
      continue;
    }

    // Only a standalone connector on the host class is a declaration of its
    // own; a port on a sub-component belongs to that component's type.
    if (isConnectorKey(parsed) && parsed.componentName === null) {
      const connector = layout.connectors[parsed.nodeId];
      if (connector === undefined) continue;
      items.push(
        await captureComponent(
          client,
          layout.className,
          parsed.nodeId,
          connector.classRef,
          connector.placement,
        ),
      );
      continue;
    }

    if (isShapeKey(parsed)) {
      const found = lookupHostShape(layout, parsed.index, parsed.shapeKind);
      if (found === null) continue;
      items.push({ kind: "shape", shape: found.shape });
    }
  }
  items.push(...connectionsWithin(layout, items));
  return items;
}

/**
 * The declaration an endpoint names: the sub-component it sits on, or — for a
 * port on the host class — the standalone connector itself.
 */
function endpointDeclaration(endpoint: ConnectionEndpoint): string {
  return endpoint.component ?? endpoint.port;
}

/**
 * The connections whose two endpoints are both declarations in `items`. Keyed
 * off the copied set rather than the selection: a rubber band sweeps the edge
 * in, but ctrl-clicking two components doesn't, and either way the user means
 * to take the wire between them.
 *
 * A subscripted endpoint is refused. `addComponent` writes a scalar, so a
 * copied `Gain gain[2]` pastes without its dimensions and a cref like
 * `gain1[1].y` would index something that isn't an array — which OMC accepts
 * and writes out, leaving a model that no longer compiles. Port subscripts are
 * kept: those dimensions come from the type, which the paste does preserve.
 */
function connectionsWithin(
  layout: DiagramLayout,
  items: readonly ClipboardEntry[],
): ClipboardConnection[] {
  const copied = new Set(
    items.filter((i) => i.kind === "component").map((i) => i.name),
  );
  if (copied.size < 2) return [];
  const inCopy = (endpoint: ConnectionEndpoint): boolean =>
    endpoint.componentSubscripts === undefined &&
    copied.has(endpointDeclaration(endpoint));
  return layout.connections
    .filter((c) => inCopy(c.lhs) && inCopy(c.rhs))
    .map(({ lhs, rhs, waypoints, source: _source, ...style }) => ({
      kind: "connection" as const,
      lhs,
      rhs,
      waypoints,
      style,
    }));
}

async function captureComponent(
  client: CopyClient,
  hostClass: string,
  name: string,
  className: string,
  placement: Placement,
): Promise<ClipboardComponent> {
  return {
    kind: "component",
    name,
    className,
    extent: placement.extent,
    rotation: placement.rotation ?? 0,
    modifiers: await readModifiers(client, hostClass, name),
  };
}

/**
 * Read the modifiers written on `elementName` in `hostClass`. A modifier that
 * comes back empty carries no binding of its own, and replaying it would clear
 * rather than set — `setElementModifierValue` treats an empty expression as a
 * removal — so it is dropped.
 */
async function readModifiers(
  client: CopyClient,
  hostClass: string,
  elementName: string,
): Promise<ClipboardModifier[]> {
  const { modifiers: names } = await client.getElementModifierNames({
    typeName: hostClass,
    elementName,
  });
  const out: ClipboardModifier[] = [];
  for (const path of names) {
    const { value } = await client.getElementModifierValue({
      typeName: hostClass,
      modifier: `${elementName}.${path}`,
    });
    if (value !== "") out.push({ path, expr: value });
  }
  return out;
}

/** What a paste attempt did, so the caller can report partial failures. */
export interface PasteResult {
  /** Instance names added, in paste order. */
  added: string[];
  /** Shapes appended to the class's own graphics annotation. */
  shapes: number;
  /** `connect()` equations added between the pasted components. */
  connections: number;
  failed: string[];
}

/**
 * Write `items` into `hostClass`, offset by `offset` diagram units.
 *
 * Sequential, and the caller reflects ONCE afterwards: reflecting writes the
 * shadow buffer, which is what records a VSCode undo step, so a reflect per
 * item would turn one paste into N undo steps.
 */
export async function pasteClipboardItems(
  client: PasteClient,
  hostClass: string,
  layout: DiagramLayout,
  items: readonly ClipboardEntry[],
  layer: GraphicsLayer,
  offset: number,
): Promise<PasteResult> {
  const result: PasteResult = {
    added: [],
    shapes: 0,
    connections: 0,
    failed: [],
  };
  // The layout is not re-fetched between adds, so every name handed out is
  // recorded here — otherwise a two-component paste would ask for the same
  // free name twice.
  const taken = takenNames(layout);
  // Copied instance name → the name it was actually pasted under, so the
  // connections can be rewired to the new components rather than the originals.
  const renamed = new Map<string, string>();

  for (const item of items) {
    if (item.kind === "connection") continue;
    if (item.kind === "shape") {
      const write = await client.writeClassGraphics({
        typeName: hostClass,
        layer,
        op: { kind: "add", shape: offsetShape(item.shape, offset) },
      });
      if (write.success) result.shapes += 1;
      else {
        result.failed.push(
          `paste ${item.shape.kind}: ${write.diagnostic ?? "OMC rejected writeClassGraphics"}`,
        );
      }
      continue;
    }

    const componentName = uniquePasteName(item.name, taken);
    taken.add(componentName);
    const outcome = await pasteComponent(
      client,
      hostClass,
      item,
      componentName,
      offset,
    );
    if (outcome.declared) {
      result.added.push(componentName);
      renamed.set(item.name, componentName);
    } else taken.delete(componentName);
    if (outcome.failure !== null) result.failed.push(outcome.failure);
  }

  // After the components exist and their final names are known.
  for (const item of items) {
    if (item.kind !== "connection") continue;
    const outcome = await pasteConnection(
      client,
      hostClass,
      item,
      renamed,
      offset,
    );
    if (outcome.kind === "added") result.connections += 1;
    if (outcome.failure !== null) result.failed.push(outcome.failure);
  }
  return result;
}

/**
 * Entity keys for what a paste just created, so the caller can hand the fresh
 * copy to the webview as the live selection — the usual next action is to drag
 * it somewhere, and hunting for it first is the annoying part.
 *
 * Resolved against the REFETCHED layout: an instance's key prefix depends on
 * whether OMC filed it as a component or a standalone connector, and appended
 * shapes are the tail of the host's own layer.
 */
export function pastedSelectionKeys(
  layout: DiagramLayout,
  result: PasteResult,
  layer: GraphicsLayer,
): string[] {
  const keys = result.added.map((name) =>
    formatEntityKey(
      Object.hasOwn(layout.connectors, name) ? "connector" : "component",
      name,
    ),
  );
  const host = findHostLayer(
    layer === "icon" ? layout.iconLayers : layout.diagramLayers,
    layout.className,
  );
  const shapes = host?.shapes ?? [];
  for (
    let i = Math.max(0, shapes.length - result.shapes);
    i < shapes.length;
    i += 1
  ) {
    const shape = shapes[i];
    if (shape !== undefined) {
      keys.push(formatEntityKey("shape", `${shape.kind}:${i}`));
    }
  }
  return keys;
}

/**
 * `skipped` is an endpoint whose declaration never landed, which is a
 * consequence of a failure already reported against that declaration rather
 * than a second thing to tell the user about.
 */
interface PasteConnectionOutcome {
  kind: "added" | "skipped" | "failed";
  failure: string | null;
}

async function pasteConnection(
  client: PasteClient,
  hostClass: string,
  item: ClipboardConnection,
  renamed: ReadonlyMap<string, string>,
  offset: number,
): Promise<PasteConnectionOutcome> {
  const lhs = remapEndpoint(item.lhs, renamed);
  const rhs = remapEndpoint(item.rhs, renamed);
  if (lhs === null || rhs === null) return { kind: "skipped", failure: null };
  const from = endpointToCref(lhs);
  const to = endpointToCref(rhs);
  const add = await client.addConnection({
    from,
    to,
    typeName: hostClass,
    annotation: lineAnnotation(
      offsetPoints(item.waypoints, offset),
      item.style,
    ),
  });
  return add.success
    ? { kind: "added", failure: null }
    : {
        kind: "failed",
        failure: `paste connect(${from}, ${to}): ${add.diagnostic ?? "OMC rejected addConnection"}`,
      };
}

/**
 * Rename whichever part of the endpoint carries its identity — the
 * sub-component, or the standalone connector's own port name. `null` when that
 * declaration wasn't pasted (its add was rejected).
 */
function remapEndpoint(
  endpoint: ConnectionEndpoint,
  renamed: ReadonlyMap<string, string>,
): ConnectionEndpoint | null {
  const pasted = renamed.get(endpointDeclaration(endpoint));
  if (pasted === undefined) return null;
  return endpoint.component === undefined
    ? { ...endpoint, port: pasted }
    : { ...endpoint, component: pasted };
}

/**
 * `declared` is whether the declaration reached the class, which is NOT the
 * same as success: a rejected modifier write leaves the component in place.
 * Reporting the two separately keeps the caller from handing the name out
 * again — and from skipping the reflect that gives the half-applied paste an
 * undo step.
 */
interface PasteComponentOutcome {
  declared: boolean;
  failure: string | null;
}

async function pasteComponent(
  client: PasteClient,
  hostClass: string,
  item: ClipboardComponent,
  componentName: string,
  offset: number,
): Promise<PasteComponentOutcome> {
  const add = await client.addComponent({
    componentName,
    componentClass: item.className,
    intoTypeName: hostClass,
    annotation: placementAnnotation(
      offsetExtent(item.extent, offset),
      item.rotation,
    ),
  });
  if (!add.success) {
    return {
      declared: false,
      failure: `paste ${item.className}: ${add.diagnostic ?? "OMC rejected addComponent"}`,
    };
  }
  for (const modifier of item.modifiers) {
    const set = await client.setElementModifierValue({
      typeName: hostClass,
      elementName: `${componentName}.${modifier.path}`,
      expr: modifier.expr,
    });
    if (!set.success) {
      return {
        declared: true,
        failure: `paste ${componentName}.${modifier.path}: ${set.diagnostic ?? "OMC rejected setElementModifierValue"}`,
      };
    }
  }
  return { declared: true, failure: null };
}

/**
 * A fresh instance name derived from the copied one: `gain` → `gain1`, and
 * `gain1` → `gain2` rather than `gain11`, so pasting a paste doesn't grow a
 * digit each round.
 */
export function uniquePasteName(
  base: string,
  taken: ReadonlySet<string>,
): string {
  return firstFreeName(base.replace(/\d+$/, ""), taken);
}
