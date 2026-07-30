import { shapeToRecord } from "@dicode/omc-client";
import type {
  ConnectionEndpoint,
  DiagramLayout,
  Placement,
  Prefixes,
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
  transformationBody,
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

/**
 * OMC surface the paste path needs: one call that parses a block of class
 * elements and merges it into the target class. Each per-element mutation
 * costs OMC real parse work, so the whole paste rides on one declaration
 * block with its modifiers inline.
 */
export interface PasteClient {
  loadClassContentString(input: {
    data: string;
    typeName: string;
  }): Promise<MutationResult>;
  /**
   * OMC reports a rejected block as a bare `false` and leaves the reason in
   * its error buffer, so this is the only way to tell the user what broke —
   * and an all-or-nothing paste has nothing else to say.
   */
  getErrorString(): Promise<{ errorString: string }>;
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
          {
            prefixes: component.prefixes,
            comment: component.comment,
            dims: component.dims,
          },
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
          {
            diagramPlacement: connector.diagramPlacement,
            prefixes: connector.prefixes,
            comment: connector.comment,
          },
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
 * A subscripted endpoint is carried alongside its component's `dims`
 * (`componentDeclaration` writes the array subscript on the declaration), so
 * `gain1[1].y` indexes a cref that really is an array. Port subscripts were
 * always kept: those dimensions come from the type, which the paste already
 * preserves.
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
  extra: {
    diagramPlacement?: Placement | undefined;
    prefixes?: Prefixes | undefined;
    comment?: string | undefined;
    dims?: readonly string[] | undefined;
  },
): Promise<ClipboardComponent> {
  return {
    kind: "component",
    name,
    className,
    extent: placement.extent,
    rotation: placement.rotation ?? 0,
    ...(placement.origin !== undefined && { origin: placement.origin }),
    ...(placement.visible === false && { visible: false }),
    ...(extra.diagramPlacement !== undefined && {
      diagramPlacement: extra.diagramPlacement,
    }),
    ...(extra.prefixes !== undefined && { prefixes: extra.prefixes }),
    ...(extra.comment !== undefined && { comment: extra.comment }),
    ...(extra.dims !== undefined && { dims: extra.dims }),
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

/** What a paste attempt did, so the caller can report the failure. */
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
 * The whole paste is one OMC call, and the caller reflects ONCE afterwards:
 * reflecting writes the shadow buffer, which is what records a VSCode undo
 * step, so a reflect per item would turn one paste into N undo steps.
 *
 * All-or-nothing: OMC parses the block as a unit.
 */
export async function pasteClipboardItems(
  client: PasteClient,
  hostClass: string,
  layout: DiagramLayout,
  items: readonly ClipboardEntry[],
  layer: GraphicsLayer,
  offset: number,
): Promise<PasteResult> {
  // The layout is not re-fetched mid-paste, so every name handed out is
  // recorded here — otherwise a two-component paste would ask for the same
  // free name twice.
  const taken = takenNames(layout);
  // Copied instance name → the name it is pasted under, so the connections can
  // be rewired to the new components rather than the originals.
  const renamed = new Map<string, string>();

  const added: string[] = [];
  const declarations: string[] = [];
  for (const item of items) {
    if (item.kind !== "component") continue;
    const componentName = uniquePasteName(item.name, taken);
    taken.add(componentName);
    renamed.set(item.name, componentName);
    added.push(componentName);
    declarations.push(componentDeclaration(item, componentName, offset, layer));
  }

  // After the final names are known, so the crefs point at the new copies.
  const connects: string[] = [];
  for (const item of items) {
    if (item.kind !== "connection") continue;
    const statement = connectStatement(item, renamed, offset);
    if (statement !== null) connects.push(statement);
  }

  const shapes: string[] = [];
  for (const item of items) {
    if (item.kind !== "shape") continue;
    shapes.push(shapeToRecord(offsetShape(item.shape, offset)));
  }

  const block = [...declarations];
  if (connects.length > 0) block.push("equation", ...connects);
  if (shapes.length > 0) {
    // OMC merges this into the existing graphics list rather than replacing
    // it, appending — which is also the paint order a paste should land in.
    const view = layer === "icon" ? "Icon" : "Diagram";
    block.push(`annotation (${view}(graphics={${shapes.join(", ")}}));`);
  }
  if (block.length === 0) {
    return { added: [], shapes: 0, connections: 0, failed: [] };
  }

  // Placements are offset as they are serialized. OMC's own offset writes an
  // `origin` rather than shifting the extent, which is not the placement the
  // rest of the edit path produces.
  const write = await client.loadClassContentString({
    data: block.join("\n"),
    typeName: hostClass,
  });
  if (!write.success) {
    const detail =
      write.diagnostic ?? (await client.getErrorString()).errorString.trim();
    return {
      added: [],
      shapes: 0,
      connections: 0,
      failed: [
        `paste: ${detail === "" ? "OMC rejected the pasted block" : detail}`,
      ],
    };
  }
  return {
    added,
    shapes: shapes.length,
    connections: connects.length,
    failed: [],
  };
}

/**
 * Declaration prefixes, in the order Modelica writes them. A declaration
 * missing them is a different declaration — an `inner` pasted plain no longer
 * answers the `outer` lookups that referenced it.
 *
 * `partial` is a class prefix, not an element one. `public` has no prefix
 * word: a protected component pastes into the public section, which is the
 * one declaration property this does not preserve. A constrained
 * `replaceable` emits the bare word without its `constrainedby` clause
 * (issue #395).
 */
function prefixWords(prefixes: Prefixes | undefined): string {
  if (!prefixes) return "";
  const words: string[] = [];
  if (prefixes.redeclare) words.push("redeclare");
  if (prefixes.final) words.push("final");
  if (prefixes.inner) words.push("inner");
  if (prefixes.outer) words.push("outer");
  if (prefixes.replaceable) words.push("replaceable");
  // `flow` / `stream` arrive as the `connector` string, not as booleans.
  if (prefixes.connector) words.push(prefixes.connector);
  if (prefixes.variability) words.push(prefixes.variability);
  if (prefixes.direction) words.push(prefixes.direction);
  return words.length === 0 ? "" : `${words.join(" ")} `;
}

/** A placement as a `transformation(...)` / `iconTransformation(...)` clause. */
function transformationClause(
  placement: Placement,
  offset: number,
  keyword: "transformation" | "iconTransformation",
): string {
  const body = transformationBody(
    offsetExtent(placement.extent, offset),
    placement.rotation ?? 0,
    placement.origin,
  );
  return `${keyword}(${body})`;
}

/**
 * The declaration's `Placement(...)`. A connector is placed once per view, so
 * one that defined both re-emits each under its own keyword — without that the
 * pasted connector loses its position in one of them.
 *
 * The paste offset lands on the extent, which adds to `origin` rather than
 * replacing it, so a placement carrying both keeps both.
 */
function placementClause(
  item: ClipboardComponent,
  offset: number,
  layer: GraphicsLayer,
): string {
  const parts: string[] = [];
  if (item.visible === false) parts.push("visible=false");
  const diagram = item.diagramPlacement;
  // With both, the item's own fields are the icon-view placement — a connector
  // is read from the icon view, whichever editor is open.
  //
  // The offset is a drop point in the pasted view's coordinates, so only that
  // view's transformation takes it; the other lives in a different coordinate
  // system the offset was never measured in.
  const iconOffset = layer === "icon" ? offset : 0;
  const diagramOffset = layer === "icon" ? 0 : offset;
  parts.push(
    diagram
      ? transformationClause(diagram, diagramOffset, "transformation")
      : transformationClause(item, offset, "transformation"),
  );
  if (diagram) {
    parts.push(transformationClause(item, iconOffset, "iconTransformation"));
  }
  return `Placement(${parts.join(", ")})`;
}

/** `Class name[dims](mods) "comment" annotation(Placement(...));` — one declaration. */
function componentDeclaration(
  item: ClipboardComponent,
  componentName: string,
  offset: number,
  layer: GraphicsLayer,
): string {
  // The array subscript sits on the declared IDENT, ahead of the modification
  // — `Real x[3](start=1)`, not `Real x(start=1)[3]` — so a vector component
  // pastes as a vector rather than the scalar `addComponent` would write.
  const dims =
    item.dims === undefined || item.dims.length === 0
      ? ""
      : `[${item.dims.join(",")}]`;
  // Modelica allows a dotted path as a modification name, so a nested modifier
  // like `limiter.uMax` needs no rewriting into nested parentheses.
  const mods = item.modifiers
    .map((m: ClipboardModifier) => `${m.path} = ${m.expr}`)
    .join(", ");
  // The description came out of OMC's JSON, so JSON quoting round-trips it —
  // the escapes only diverge from Modelica's string grammar for control
  // characters, which a description does not carry.
  const comment =
    item.comment === undefined || item.comment === ""
      ? ""
      : ` ${JSON.stringify(item.comment)}`;
  return `${prefixWords(item.prefixes)}${item.className} ${componentName}${dims}${mods === "" ? "" : `(${mods})`}${comment} annotation(${placementClause(item, offset, layer)});`;
}

/** `connect(a, b) annotation (Line(...));`, or `null` when an endpoint's
 *  declaration wasn't part of this paste. */
function connectStatement(
  item: ClipboardConnection,
  renamed: ReadonlyMap<string, string>,
  offset: number,
): string | null {
  const lhs = remapEndpoint(item.lhs, renamed);
  const rhs = remapEndpoint(item.rhs, renamed);
  if (lhs === null || rhs === null) return null;
  const line = lineAnnotation(offsetPoints(item.waypoints, offset), item.style);
  const annotation = line === "" ? "" : ` annotation (${line})`;
  return `connect(${endpointToCref(lhs)}, ${endpointToCref(rhs)})${annotation};`;
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
 * Rename whichever part of the endpoint carries its identity — the
 * sub-component, or the standalone connector's own port name. `null` when that
 * declaration wasn't part of this paste.
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
