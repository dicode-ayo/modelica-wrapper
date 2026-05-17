/**
 * Pure producer: `ModelInstance` (validated upstream by Zod) →
 * `DiagramLayout` (renderer-agnostic, class-deduplicated).
 *
 * No OMC contact, no rendering. The producer:
 *  1. Walks the host class's extends chain to collect own visuals (icon
 *     and/or diagram) layered ancestor-first.
 *  2. Walks the same chain for standalone connectors (ports declared on
 *     the host or any ancestor).
 *  3. Walks the host's `elements` for sub-components, building a
 *     deduplicated class catalog keyed by `type.name` — each class
 *     entry has its own walked icon and connector list.
 *  4. Emits connections that have an `annotation.Line`; equation-only
 *     `connect(...)` calls (no annotation) are skipped, since they
 *     carry no diagram intent.
 *
 * v1 dedup is by `type.name` only. If the same name appears twice with
 * structurally different content (a redeclare edge case), the FIRST
 * occurrence wins. Content-hashing for redeclare collisions is out of
 * scope; this is documented at the call site in `registerClass`.
 */

import type {
  ComponentElement,
  ConnectionNode,
  ModelInstance,
  RecordValue,
} from "../../_shared/modelInstance.js";
import type {
  ClassDef,
  CoordinateSystem,
  ConnectionLayout,
  ComponentInstance,
  ConnectorInstance,
  DiagramLayout,
  IconLayer,
  LabelLayout,
  PortDef,
  Shape,
  TextShape,
} from "../../_shared/diagramLayout.js";
import { decodeShape } from "./shapes.js";
import { flattenCref, placementFor } from "./placement.js";
import {
  ownConnectors,
  ownSubComponents,
  walkConnectors,
  walkExtendsChain,
} from "./walker.js";

// ---------- icon-layer collection ----------

function graphicsForKind(
  mi: ModelInstance,
  kind: "icon" | "diagram",
): RecordValue[] {
  const block = kind === "icon" ? mi.annotation?.Icon : mi.annotation?.Diagram;
  return block?.graphics ?? [];
}

function coordinateSystemForKind(
  mi: ModelInstance,
  kind: "icon" | "diagram",
): CoordinateSystem | undefined {
  const block = kind === "icon" ? mi.annotation?.Icon : mi.annotation?.Diagram;
  return block?.coordinateSystem;
}

/**
 * Build the layered icon (or diagram) for a class. Each ancestor in the
 * extends chain contributes one `IconLayer`; the host class's own layer
 * comes last. Empty layers (ancestors with no graphics in this kind) are
 * still yielded so the consumer sees the full chain — they help renderers
 * line up coordinate systems and debugging.
 *
 * If a layer has no shapes AND no coordinate system, we drop it: it adds
 * no information. The non-empty `from` is preserved when either is
 * present, so a "carries the parent's coord system but no visuals" layer
 * still appears.
 */
function collectLayers(
  mi: ModelInstance,
  kind: "icon" | "diagram",
): IconLayer[] {
  const out: IconLayer[] = [];
  for (const klass of walkExtendsChain(mi)) {
    const graphics = graphicsForKind(klass, kind);
    const cs = coordinateSystemForKind(klass, kind);
    if (graphics.length === 0 && !cs) continue;
    const shapes: Shape[] = [];
    for (const g of graphics) {
      try {
        shapes.push(decodeShape(g));
      } catch (err) {
        // Re-throw with context so the bad shape's path is identifiable
        // in fixture testing. Decoder errors already include the offending
        // field's index.
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `collectLayers(${kind}): failed decoding shape on class '${klass.name}': ${msg}`,
        );
      }
    }
    const layer: IconLayer = { from: klass.name, shapes };
    if (cs) layer.coordinateSystem = cs;
    out.push(layer);
  }
  return out;
}

// ---------- top-level Diagram-mode labels ----------

/**
 * Diagram-mode TEXT shapes on the HOST class only (not ancestors). These
 * are conventionally used for human-readable annotations like
 * "reference speed generation". The list mirrors the host's diagram
 * graphics where `name === "Text"`; non-text diagram shapes (frames,
 * legends drawn as Rectangle/Line) stay in `diagramLayers`.
 *
 * Note: this populates DiagramLayout.labels regardless of the requested
 * `kind`, since labels can be useful in either rendering mode. A renderer
 * that wants to skip them in icon mode can filter by `layout.kind`.
 */
function collectLabels(mi: ModelInstance): LabelLayout[] {
  const out: LabelLayout[] = [];
  const graphics = mi.annotation?.Diagram?.graphics ?? [];
  for (const g of graphics) {
    if (g.name !== "Text") continue;
    let shape: Shape;
    try {
      shape = decodeShape(g);
    } catch {
      // A malformed label shouldn't kill the whole layout; skip it
      // silently here (the same shape, if it's in `diagramLayers`,
      // would have already thrown there).
      continue;
    }
    if (shape.kind !== "text") continue;
    const ts = shape as TextShape;
    const label: LabelLayout = {
      text: ts.textString,
      extent: ts.extent,
      rotation: 0,
    };
    if (ts.fontSize !== undefined) label.fontSize = ts.fontSize;
    if (ts.textColor) label.textColor = ts.textColor;
    out.push(label);
  }
  return out;
}

// ---------- class registry ----------

/**
 * Build a `ClassDef` from a sub-component's `type` ModelInstance. Walks
 * the type's extends chain for both icons and ports, and recursively
 * registers any nested classes encountered through ports' connector
 * types so they're in the catalog too.
 */
function buildClassDef(typeMi: ModelInstance, registry: Map<string, ClassDef>): ClassDef {
  const iconLayers = collectLayers(typeMi, "icon");
  const cs = coordinateSystemForKind(typeMi, "icon");
  const connectors: Record<string, PortDef> = {};
  for (const { from, element } of walkConnectors(typeMi)) {
    const port = portFromConnector(element, from, registry);
    if (port) connectors[port.name] = port;
  }
  const def: ClassDef = {
    name: typeMi.name,
    restriction: typeMi.restriction,
    iconLayers,
    connectors,
  };
  if (cs) def.coordinateSystem = cs;
  return def;
}

/**
 * Register a class in the catalog if it's not already there.
 *
 * v1 dedup key: `type.name`. If the same name shows up with non-equal
 * content trees (a redeclare collision), the first occurrence wins —
 * subsequent calls are no-ops. We don't content-hash today; treating
 * redeclare collisions correctly is a v2 concern.
 */
function registerClass(typeMi: ModelInstance, registry: Map<string, ClassDef>): string {
  const key = typeMi.name;
  if (registry.has(key)) return key;
  // Insert a placeholder first so cycles through ports → connector class →
  // … cannot recurse forever. Modelica forbids declarative cycles, but the
  // ModelInstance shape is just JSON, so be defensive.
  const placeholder: ClassDef = {
    name: typeMi.name,
    restriction: typeMi.restriction,
    iconLayers: [],
    connectors: {},
  };
  registry.set(key, placeholder);
  const built = buildClassDef(typeMi, registry);
  registry.set(key, built);
  return key;
}

/**
 * Decode a connector component into a `PortDef`. The connector's `type`
 * must be a `ModelInstance` (we check upstream). Placement comes from
 * `iconTransformation` if present (host-icon-relative position of the
 * port), falling back to `transformation`.
 *
 * Side effect: registers the connector's class in `registry` so renderers
 * can look up the port's own icon via `classes[port.typeName].iconLayers`.
 * (We ALSO embed `iconLayers` directly on the PortDef for convenience.)
 */
function portFromConnector(
  el: ComponentElement,
  from: string,
  registry: Map<string, ClassDef>,
): PortDef | undefined {
  if (typeof el.type !== "object" || el.type === null) return undefined;
  const placement = placementFor(el, "icon");
  if (!placement) return undefined;
  const typeMi = el.type;
  const typeName = typeMi.name;
  registerClass(typeMi, registry);
  const iconLayers = collectLayers(typeMi, "icon");
  const port: PortDef = {
    name: el.name,
    typeName,
    placement,
    iconLayers,
    from,
  };
  // Forward direction/flow/stream so connection-creation UIs can do
  // a local compatibility check (input ↔ output, flow ↔ flow) before
  // calling `addConnection`. `direction` is a free-form string from
  // OMC; we narrow to the known causality values and drop anything
  // else (Modelica reserves the field but doesn't constrain it).
  const prefixes = el.prefixes;
  if (prefixes) {
    if (prefixes.direction === "input" || prefixes.direction === "output") {
      port.direction = prefixes.direction;
    } else if (prefixes.direction === "") {
      port.direction = "";
    }
    if (prefixes.flow !== undefined) port.flow = prefixes.flow;
    if (prefixes.stream !== undefined) port.stream = prefixes.stream;
  }
  if (typeMi.source) port.source = typeMi.source;
  return port;
}

// ---------- per-instance components & connectors ----------

function instanceFromSubComponent(
  el: ComponentElement,
  kind: "icon" | "diagram",
  registry: Map<string, ClassDef>,
): ComponentInstance | undefined {
  if (typeof el.type !== "object" || el.type === null) return undefined;
  const placement = placementFor(el, kind);
  if (!placement) return undefined;
  const classRef = registerClass(el.type, registry);
  const instance: ComponentInstance = {
    name: el.name,
    classRef,
    placement,
  };
  if (el.modifiers !== undefined) instance.modifiers = el.modifiers;
  if (el.comment !== undefined) instance.comment = el.comment;
  if (el.type.source) instance.source = el.type.source;
  return instance;
}

function instanceFromConnector(
  el: ComponentElement,
  registry: Map<string, ClassDef>,
): ConnectorInstance | undefined {
  if (typeof el.type !== "object" || el.type === null) return undefined;
  const placement = placementFor(el, "icon");
  if (!placement) return undefined;
  const classRef = registerClass(el.type, registry);
  const inst: ConnectorInstance = {
    name: el.name,
    classRef,
    placement,
  };
  if (el.comment !== undefined) inst.comment = el.comment;
  if (el.type.source) inst.source = el.type.source;
  return inst;
}

// ---------- connection emission ----------

/**
 * Decode the points list of an `annotation.Line.points` value into typed
 * waypoints. OMC emits the points as `[[x, y], [x, y], ...]`. Missing /
 * empty points yields `[]` ("auto-route").
 */
function waypointsFromLine(line: unknown): { x: number; y: number }[] {
  if (typeof line !== "object" || line === null) return [];
  const points = (line as { points?: unknown }).points;
  if (!Array.isArray(points)) return [];
  const out: { x: number; y: number }[] = [];
  for (const p of points) {
    if (
      Array.isArray(p) &&
      p.length === 2 &&
      typeof p[0] === "number" &&
      typeof p[1] === "number"
    ) {
      out.push({ x: p[0], y: p[1] });
    }
  }
  return out;
}

function emitConnection(c: ConnectionNode): ConnectionLayout | undefined {
  const annotation = c.annotation as { Line?: unknown } | undefined;
  if (!annotation) return undefined;
  const line = annotation.Line;
  if (line === undefined || line === null) return undefined;
  const lhs = flattenCref(c.lhs);
  const rhs = flattenCref(c.rhs);
  if (!lhs || !rhs) return undefined;
  const waypointsXY = waypointsFromLine(line);
  // Convert {x,y} back to [x,y] tuples for the public type.
  const waypoints = waypointsXY.map((p) => [p.x, p.y] as [number, number]);
  return { lhs, rhs, waypoints };
}

// ---------- entry point ----------

/**
 * Produce a `DiagramLayout` for `mi` in the requested mode.
 *
 *  - `kind: "icon"` — populates `iconLayers` (host's own icon + ancestor
 *    layers, post-order) and per-instance placements as `iconTransformation`
 *    (renderable in an icon-only context). `diagramLayers` is empty.
 *  - `kind: "diagram"` — same icon layers plus `diagramLayers` (host's
 *    own diagram graphics + ancestor diagram layers), per-instance
 *    placements as `transformation`, and `connections` populated.
 *
 * The choice doesn't filter `classes` or `components`/`connectors` — those
 * always describe the full host-class structure. Only what gets DRAWN
 * differs by kind.
 */
export function produceDiagramLayout(
  mi: ModelInstance,
  kind: "icon" | "diagram",
): DiagramLayout {
  const registry = new Map<string, ClassDef>();

  const iconLayers = collectLayers(mi, "icon");
  const diagramLayers = kind === "diagram" ? collectLayers(mi, "diagram") : [];
  const labels = kind === "diagram" ? collectLabels(mi) : [];

  // Standalone connectors on the host class (and ancestors), inheritance-aware.
  const connectors: Record<string, ConnectorInstance> = {};
  for (const { element } of walkConnectors(mi)) {
    // Also seed the connector's class into the registry so consumers can
    // look up its own icon via `classes[connector.classRef]`.
    const inst = instanceFromConnector(element, registry);
    if (inst) {
      // Later (more-derived) declarations override earlier ones if they
      // collide; walkConnectors yields ancestors first, so this is a
      // pass-through assignment that preserves the override semantics.
      connectors[inst.name] = inst;
    }
  }

  // Sub-components: walk the host class only (ancestors usually don't
  // declare placement-bearing subcomponents themselves; if they do, those
  // are part of the ancestor's icon, NOT host-class instances).
  const components: Record<string, ComponentInstance> = {};
  for (const el of ownSubComponents(mi)) {
    const inst = instanceFromSubComponent(el, kind === "icon" ? "icon" : "diagram", registry);
    if (inst) components[inst.name] = inst;
  }
  // Same for any sub-components declared on ancestors. They DO show up
  // in PID-style examples sometimes (e.g., Modelica.Icons.Example doesn't
  // declare any, but other ancestors might). Walk the chain, skip the
  // host (already done) and skip duplicates.
  for (const klass of walkExtendsChain(mi)) {
    if (klass === mi) continue;
    for (const el of ownSubComponents(klass)) {
      if (components[el.name]) continue;
      const inst = instanceFromSubComponent(el, kind === "icon" ? "icon" : "diagram", registry);
      if (inst) components[inst.name] = inst;
    }
  }
  // Standalone connectors on ancestors of the host: walkConnectors above
  // already covered them. The component name (port name) wins from the
  // most-derived declaration.

  // Same trick for ancestor-declared standalone connectors? Already
  // handled above by walkConnectors which iterates the chain.

  // ALSO ensure `classes` is populated for any ports on connector classes
  // (the connector itself might extend another class with its own visuals).
  // `registerClass` already recurses through `buildClassDef`, so the
  // catalog should be complete after the loops above.

  const connections: ConnectionLayout[] = [];
  if (kind === "diagram") {
    for (const c of mi.connections ?? []) {
      const cl = emitConnection(c);
      if (cl) connections.push(cl);
    }
  }

  const layout: DiagramLayout = {
    kind,
    className: mi.name,
    source: mi.source ?? {
      filename: "<unknown>",
      lineStart: 0,
      columnStart: 0,
      lineEnd: 0,
      columnEnd: 0,
    },
    iconLayers,
    diagramLayers,
    labels,
    classes: Object.fromEntries(registry),
    components,
    connectors,
    connections,
  };
  const cs = coordinateSystemForKind(mi, kind);
  if (cs) layout.coordinateSystem = cs;
  return layout;
}

/** For tests / external introspection — kept off the public barrel. */
export const _internal = {
  collectLayers,
  collectLabels,
  registerClass,
  emitConnection,
  ownConnectors,
};
