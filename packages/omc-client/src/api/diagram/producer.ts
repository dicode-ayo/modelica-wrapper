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
 *     deduplicated class catalog — each class entry has its own walked
 *     icon and connector list.
 *  4. Emits connections that have an `annotation.Line`; equation-only
 *     `connect(...)` calls (no annotation) are skipped, since they
 *     carry no diagram intent.
 *
 * A class's graphics reduce against the use site — `Torque(useSupport =
 * true)` draws no ground symbol — so one class name can need more than one
 * icon. The catalog keys on the class name plus the content it resolved to:
 * identical content shares an entry, and a name that resolves two ways gets
 * a suffixed second key. `ClassDef.name` stays the real class name, so a
 * catalog key is an identifier and not a name to display.
 */

import type {
  ComponentElement,
  ConnectionNode,
  Expression,
  ModelInstance,
  RecordValue,
} from "../../_shared/modelInstance.js";
import { hasDrawnShapes } from "../../shapes/layers.js";
import type {
  ClassDef,
  Color,
  CoordinateSystem,
  ConnectionEndpoint,
  ConnectionLayout,
  ComponentInstance,
  ConnectorInstance,
  DiagramLayout,
  IconLayer,
  LabelLayout,
  LineStyle,
  ParameterDef,
  PortDef,
  Shape,
  TextShape,
} from "../../_shared/diagramLayout.js";
import type { EvalScope } from "../../eval/expression-evaluator.js";
import { evaluateExpression } from "../../eval/expression-evaluator.js";
import { modelInstanceScope } from "../../eval/model-instance-scope.js";
import { decodeShape } from "./shapes.js";
import {
  counterpartPlacementFor,
  flattenCref,
  placementFor,
} from "./placement.js";
import {
  ownConnectors,
  ownParameters,
  ownSubComponents,
  walkConnectors,
  walkLayerEntries,
} from "./walker.js";
import { walkExtendsChain } from "../../_shared/extendsChain.js";
import {
  modifierToDisplayString,
  resolveDisplayUnit,
  resolveUnit,
} from "../../_shared/unitResolution.js";

// ---------- condition gating ----------

/**
 * Decide whether a component or port should appear in the layout given its
 * `condition` field, which OMC emits either bare (`condition: false`) or
 * inside its Value wrapper (`condition: { binding: false }`).
 *
 * Modelica §4.4.5 requires an `if`-condition to be parameter-expressible,
 * and OMC reduces them before serializing — but it does NOT reduce the
 * equivalent expressions in graphic annotations, and nothing in the payload
 * marks which is which. Reducing both through the same evaluator drops that
 * distinction, so a port and the graphics drawn for it can't disagree.
 *
 * A condition that won't reduce means "visible" — the fail-open policy the
 * graphic decoder and the form-side Dialog.enable both follow.
 */
function isConditionTrue(condition: unknown, scope: EvalScope): boolean {
  if (condition === undefined || condition === null) return true;
  const expr =
    typeof condition === "object" && "binding" in (condition as object)
      ? (condition as { binding: unknown }).binding
      : condition;
  return (
    evaluateExpression(expr as Expression, scope, { fallback: true }) !== false
  );
}

// ---------- parameter extraction ----------

/**
 * Format a `value.binding` payload as a display string. OMC emits the
 * resolved binding as either a primitive or a tagged record (enum,
 * function call, …). For text substitution we only need the primitive
 * forms — anything richer falls back to `""` and the caller will try
 * the literal modifier next.
 */
function bindingToDisplayString(binding: unknown): string {
  if (binding === null || binding === undefined) return "";
  if (typeof binding === "string") return binding;
  if (typeof binding === "number" || typeof binding === "boolean") {
    return String(binding);
  }
  if (
    typeof binding === "object" &&
    binding !== null &&
    "$kind" in (binding as Record<string, unknown>)
  ) {
    const tagged = binding as {
      $kind: string;
      name?: unknown;
      index?: unknown;
    };
    if (tagged.$kind === "enum" && typeof tagged.name === "string") {
      const dot = tagged.name.lastIndexOf(".");
      return dot >= 0 ? tagged.name.slice(dot + 1) : tagged.name;
    }
  }
  return "";
}

/**
 * Extract the display value for a parameter component. Prefer the
 * resolved `value.binding` (post-eval, what the user sees as the
 * effective default); fall back to the literal `modifiers.$value`
 * (pre-eval expression text) if no binding exists.
 */
function parameterDisplayValue(el: ComponentElement): string {
  const value = el.value as { binding?: unknown } | undefined;
  if (value && "binding" in value) {
    const s = bindingToDisplayString(value.binding);
    if (s.length > 0) return s;
  }
  return modifierToDisplayString(el.modifiers);
}

function collectParameters(mi: ModelInstance): Record<string, ParameterDef> {
  const out: Record<string, ParameterDef> = {};
  // walkExtendsChain yields ancestors first, host last. Iterating in
  // that order means more-derived declarations overwrite ancestor ones,
  // which matches Modelica's redeclare / modifier override semantics.
  for (const { klass } of walkExtendsChain(mi)) {
    for (const el of ownParameters(klass)) {
      const def: ParameterDef = {
        name: el.name,
        value: parameterDisplayValue(el),
      };
      const unit = resolveUnit(el);
      if (unit !== undefined) def.unit = unit;
      const displayUnit = resolveDisplayUnit(el);
      if (displayUnit !== undefined) def.displayUnit = displayUnit;
      if (el.comment !== undefined) def.comment = el.comment;
      out[el.name] = def;
    }
  }
  return out;
}

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
  scope: EvalScope,
): IconLayer[] {
  const out: IconLayer[] = [];
  for (const { klass, primitivesVisible } of walkLayerEntries(mi, kind)) {
    const graphics = primitivesVisible ? graphicsForKind(klass, kind) : [];
    const cs = coordinateSystemForKind(klass, kind);
    if (graphics.length === 0 && !cs) continue;
    const shapes: Shape[] = [];
    for (const g of graphics) {
      try {
        shapes.push(decodeShape(g, scope));
      } catch (err) {
        // Re-throw with context so the bad shape's path is identifiable
        // in fixture testing. Decoder errors already include the offending
        // field's index.
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `collectLayers(${kind}): failed decoding shape on class '${klass.name}': ${msg}`,
          { cause: err },
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
 * These shapes also reach `diagramLayers` — `collectLayers` does not
 * filter `Text` — so `DiagramLayout.labels` is a redundant view of them,
 * kept for consumers that want the annotations alone. `<om-graphical-layout>`
 * renders the layers and ignores this field; a consumer that renders both
 * draws every annotation twice.
 */
function collectLabels(mi: ModelInstance, scope: EvalScope): LabelLayout[] {
  const out: LabelLayout[] = [];
  const graphics = mi.annotation?.Diagram?.graphics ?? [];
  for (const g of graphics) {
    if (g.name !== "Text") continue;
    let shape: Shape;
    try {
      shape = decodeShape(g, scope);
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

/**
 * The layers an icon context shows for a class, with the annotation
 * fallback applied: the `Icon` annotation's layers, or the `Diagram`
 * annotation's when the icon draws nothing. MLS §18.2 gives a class two
 * graphical representations without requiring both; a hand-written
 * connector often carries only a `Diagram`, and without the fallback it
 * renders as nothing while its port disc stays hit-testable. Applies to
 * the class CATALOG only (`ClassDef` / `PortDef`) — a host class's own
 * `DiagramLayout.iconLayers` / `diagramLayers` are positionally addressed
 * by `shape:<idx>` keys and diffed into source writes, so a substituted
 * layer there would shift indices and leak into user source.
 */
function iconContextLayers(
  mi: ModelInstance,
  scope: EvalScope,
): {
  layers: IconLayer[];
  from: "icon" | "diagram";
} {
  const icon = collectLayers(mi, "icon", scope);
  if (hasDrawnShapes(icon)) return { layers: icon, from: "icon" };
  const diagram = collectLayers(mi, "diagram", scope);
  if (hasDrawnShapes(diagram)) return { layers: diagram, from: "diagram" };
  return { layers: icon, from: "icon" };
}

// ---------- class registry ----------

/**
 * The per-layout class catalog. Every instance builds its own def, since the
 * content depends on the use site; `keyByFingerprint` folds identical builds
 * onto one key. `building` breaks cycles without parking an incomplete def
 * in `defs`.
 */
interface ClassRegistry {
  defs: Map<string, ClassDef>;
  keyByFingerprint: Map<string, string>;
  building: Set<string>;
}

function newClassRegistry(): ClassRegistry {
  return {
    defs: new Map(),
    keyByFingerprint: new Map(),
    building: new Set(),
  };
}

/**
 * Build a `ClassDef` from a sub-component's `type` ModelInstance. Walks
 * the type's extends chain for both icons and ports, and recursively
 * registers any nested classes encountered through ports' connector
 * types so they're in the catalog too.
 */
function buildClassDef(
  typeMi: ModelInstance,
  registry: ClassRegistry,
  scope: EvalScope,
): ClassDef {
  const icon = iconContextLayers(typeMi, scope);
  const diagramLayers = collectLayers(typeMi, "diagram", scope);
  // Each layer set is scaled against the annotation it came from, so an icon
  // sourced from the `Diagram` fallback isn't measured in the icon's system.
  const cs = coordinateSystemForKind(typeMi, icon.from);
  const diagramCs = coordinateSystemForKind(typeMi, "diagram");
  const connectors: Record<string, PortDef> = {};
  for (const { from, element } of walkConnectors(typeMi)) {
    const port = portFromConnector(element, from, registry, scope);
    if (port) connectors[port.name] = port;
  }
  const def: ClassDef = {
    name: typeMi.name,
    restriction: typeMi.restriction,
    iconLayers: icon.layers,
    connectors,
    parameters: collectParameters(typeMi),
  };
  if (hasDrawnShapes(diagramLayers)) {
    def.diagramLayers = diagramLayers;
    if (diagramCs) def.diagramCoordinateSystem = diagramCs;
  }
  if (cs) def.coordinateSystem = cs;
  return def;
}

/**
 * Build a self-contained `ClassDef` for a class in isolation — its icon,
 * coordinate system, and ports — from that class's own `ModelInstance`. Unlike
 * {@link produceDiagramLayout}, which lays a class out as a diagram, this yields
 * the class as it appears when placed as a component. Used to render a
 * placement preview without adding the component first.
 */
export function produceComponentClass(mi: ModelInstance): ClassDef {
  return buildClassDef(mi, newClassRegistry(), modelInstanceScope(mi));
}

/**
 * Adopt a freshly built def under a key that determines it. A class whose
 * graphics reduce against use-site parameters no longer has one icon —
 * `Torque(useSupport = true)` and `Torque(useSupport = false)` draw
 * differently — so the catalog keys on the content, not the name alone.
 * Identical content shares one entry, which is every ordinary class.
 */
function adopt(registry: ClassRegistry, name: string, built: ClassDef): string {
  const fingerprint = JSON.stringify(built);
  const seen = registry.keyByFingerprint.get(fingerprint);
  if (seen !== undefined) return seen;
  let key = name;
  for (let n = 2; registry.defs.has(key); n++) key = `${name}#${n}`;
  registry.defs.set(key, built);
  registry.keyByFingerprint.set(fingerprint, key);
  return key;
}

/**
 * Register a class in the catalog, returning the key it lives under.
 *
 * A class reached again while its own def is still being built (ports →
 * connector class → …) resolves to the bare name rather than recursing.
 * Modelica forbids declarative cycles, but the ModelInstance shape is just
 * JSON, so nothing upstream guarantees it. That reference is dangling by
 * design: the def may settle under a suffixed key, or not yet exist.
 */
function registerClass(
  typeMi: ModelInstance,
  registry: ClassRegistry,
  scope: EvalScope,
): string {
  const name = typeMi.name;
  if (registry.building.has(name)) return name;
  registry.building.add(name);
  try {
    return adopt(registry, name, buildClassDef(typeMi, registry, scope));
  } finally {
    registry.building.delete(name);
  }
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
  registry: ClassRegistry,
  scope: EvalScope,
): PortDef | undefined {
  if (typeof el.type !== "object" || el.type === null) return undefined;
  const placement = placementFor(el, "icon");
  if (!placement) return undefined;
  const typeMi = el.type;
  const typeName = typeMi.name;
  registerClass(typeMi, registry, scope);
  const { layers: iconLayers } = iconContextLayers(typeMi, scope);
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
    // OMC reports the connector prefix as the word itself, not as booleans.
    if (prefixes.connector === "flow") port.flow = true;
    if (prefixes.connector === "stream") port.stream = true;
  }
  if (typeMi.source) port.source = typeMi.source;
  return port;
}

// ---------- array dimensions ----------

/**
 * Decode a `ComponentElement.dims` payload into the per-dimension size
 * strings used for the `%name` array suffix. OMC 1.26.7 serializes dims
 * as `{ absyn: string[], typed: string[] }`:
 *
 *   `Real[3] v`        → { absyn: ["3"],      typed: ["3"] }
 *   `Real[n] pins`     → { absyn: ["n"],      typed: ["3"] }   (n = 3)
 *   `Real[2, 4] grid`  → { absyn: ["2", "4"], typed: ["2", "4"] }
 *
 * We prefer `typed` (the reduced integer sizes — what the user sees as
 * the concrete dimension, matching OMEdit's `getTypedDimensionsString`),
 * falling back to `absyn` when OMC couldn't reduce a dimension. Returns
 * `undefined` for scalar components (no `dims`) or an unrecognized shape.
 */
function dimsFromElement(el: ComponentElement): string[] | undefined {
  const dims = el.dims;
  if (typeof dims !== "object" || dims === null) return undefined;
  const record = dims as { typed?: unknown; absyn?: unknown };
  const source = Array.isArray(record.typed)
    ? record.typed
    : Array.isArray(record.absyn)
      ? record.absyn
      : undefined;
  if (source === undefined) return undefined;
  const out: string[] = [];
  for (const d of source) {
    if (typeof d === "string") out.push(d);
    else if (typeof d === "number") out.push(String(d));
    else return undefined;
  }
  return out.length > 0 ? out : undefined;
}

// ---------- per-instance components & connectors ----------

function instanceFromSubComponent(
  el: ComponentElement,
  kind: "icon" | "diagram",
  registry: ClassRegistry,
  scope: EvalScope,
): ComponentInstance | undefined {
  if (typeof el.type !== "object" || el.type === null) return undefined;
  const placement = placementFor(el, kind);
  if (!placement) return undefined;
  const classRef = registerClass(el.type, registry, scope);
  const instance: ComponentInstance = {
    name: el.name,
    classRef,
    placement,
  };
  if (el.modifiers !== undefined) instance.modifiers = el.modifiers;
  if (el.comment !== undefined) instance.comment = el.comment;
  if (el.prefixes !== undefined) instance.prefixes = el.prefixes;
  if (el.type.source) instance.source = el.type.source;
  // Array dimensions: a vector / matrix component carries `dims`; surface
  // the reduced sizes so the renderer can append `[3]` / `[2, 4]` to the
  // `%name` label (OMEdit `TextAnnotation.cpp:691-714`).
  const dims = dimsFromElement(el);
  if (dims !== undefined) instance.dims = dims;
  // Per-instance port hiding: walk the type's connectors and collect any
  // whose `condition` reduces to false. OMC reduces the predicate against
  // the use-site modifiers before serialization (e.g.
  // `Torque(useSupport=false)` arrives with `support.condition = false`),
  // but emits it in BOTH shapes — a bare `false` AND the wrapped
  // `{ binding: false }` Value form. Route the check through
  // `isConditionTrue` (issue #76, item 5) so both are gated, matching the
  // host-level component gating. An unresolved Expression AST defaults to
  // "visible" — same "default to visible" policy as the host path.
  const hiddenPorts: string[] = [];
  for (const { element } of walkConnectors(el.type)) {
    if (!isConditionTrue(element.condition, scope)) {
      hiddenPorts.push(element.name);
    }
  }
  if (hiddenPorts.length > 0) instance.hiddenPorts = hiddenPorts;
  return instance;
}

/**
 * Placement rule (MLS §18.2): `Placement.transformation` positions an
 * element in the enclosing class's diagram layer, `iconTransformation` in
 * its icon layer — so a standalone connector takes the transformation
 * matching the layout's `kind`, each falling back to the other when only
 * one is declared (`placementFor`). Each kind additionally carries the
 * unread counterpart when the declaration defines both — `diagramPlacement`
 * on an icon-kind layout, `iconPlacement` on a diagram-kind one — so write
 * paths can re-emit both keywords.
 */
function instanceFromConnector(
  el: ComponentElement,
  kind: "icon" | "diagram",
  registry: ClassRegistry,
  scope: EvalScope,
): ConnectorInstance | undefined {
  if (typeof el.type !== "object" || el.type === null) return undefined;
  const placement = placementFor(el, kind);
  if (!placement) return undefined;
  const classRef = registerClass(el.type, registry, scope);
  const inst: ConnectorInstance = {
    name: el.name,
    classRef,
    placement,
  };
  const counterpart = counterpartPlacementFor(el, kind);
  if (counterpart) {
    if (kind === "icon") inst.diagramPlacement = counterpart;
    else inst.iconPlacement = counterpart;
  }
  if (el.comment !== undefined) inst.comment = el.comment;
  if (el.prefixes !== undefined) inst.prefixes = el.prefixes;
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

/**
 * Decode an `annotation.Line.color` value (`[r, g, b]`, each 0–255) into a
 * typed `Color`. Anything else (missing, wrong arity, non-numeric) yields
 * `undefined` so the renderer falls back to its default edge color.
 */
function colorFromLine(line: unknown): Color | undefined {
  if (typeof line !== "object" || line === null) return undefined;
  const c = (line as { color?: unknown }).color;
  if (
    Array.isArray(c) &&
    c.length === 3 &&
    typeof c[0] === "number" &&
    typeof c[1] === "number" &&
    typeof c[2] === "number"
  ) {
    return [c[0], c[1], c[2]];
  }
  return undefined;
}

/**
 * Strip an enum literal (`{ $kind: "enum", name: "LinePattern.Dash", ... }`)
 * or a bare qualified string down to its unqualified suffix (`"Dash"`).
 * OMC's `getModelInstance` emits Line's enum-typed fields (`pattern`,
 * `arrow`, `smooth`) as enum literals, matching `EnumLiteral` in
 * `modelInstance.ts`.
 */
function enumTail(v: unknown): string | undefined {
  const name =
    typeof v === "string"
      ? v
      : typeof v === "object" &&
          v !== null &&
          (v as { $kind?: unknown }).$kind === "enum" &&
          typeof (v as { name?: unknown }).name === "string"
        ? ((v as { name: string }).name as string)
        : undefined;
  if (name === undefined) return undefined;
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

/** Decode `annotation.Line.thickness` (a plain number). */
function thicknessFromLine(line: unknown): number | undefined {
  if (typeof line !== "object" || line === null) return undefined;
  const t = (line as { thickness?: unknown }).thickness;
  return typeof t === "number" && Number.isFinite(t) ? t : undefined;
}

/** Decode `annotation.Line.pattern` (a `LinePattern` enum literal). */
function patternFromLine(line: unknown): string | undefined {
  if (typeof line !== "object" || line === null) return undefined;
  return enumTail((line as { pattern?: unknown }).pattern);
}

/** Decode `annotation.Line.arrow` (`{Arrow.<start>, Arrow.<end>}`). */
function arrowFromLine(line: unknown): [string, string] | undefined {
  if (typeof line !== "object" || line === null) return undefined;
  const a = (line as { arrow?: unknown }).arrow;
  if (!Array.isArray(a) || a.length !== 2) return undefined;
  const head = enumTail(a[0]);
  const tail = enumTail(a[1]);
  return head !== undefined && tail !== undefined ? [head, tail] : undefined;
}

/** Decode `annotation.Line.arrowSize` (a plain number). */
function arrowSizeFromLine(line: unknown): number | undefined {
  if (typeof line !== "object" || line === null) return undefined;
  const s = (line as { arrowSize?: unknown }).arrowSize;
  return typeof s === "number" && Number.isFinite(s) ? s : undefined;
}

/** Decode `annotation.Line.smooth` (a `Smooth` enum literal). */
function smoothFromLine(line: unknown): string | undefined {
  if (typeof line !== "object" || line === null) return undefined;
  return enumTail((line as { smooth?: unknown }).smooth);
}

/**
 * True when a connection endpoint resolves to a node/port that survived
 * gating (issue #76, item 6).
 *
 *  - Host-class port (`component === undefined`): always visible — it's a
 *    connector declared on the opened class itself, which gating leaves in
 *    `connectors` only if its own condition held; a bare host port reference
 *    that isn't a known connector is left visible (default-to-visible policy,
 *    same as host-level gating's unresolved-AST branch).
 *  - Sub-component / standalone-connector endpoint: the root cref must be a
 *    surviving `component` or `connector`, AND — for a component — the named
 *    port must not be in that component's `hiddenPorts`.
 */
function endpointVisible(
  ep: ConnectionEndpoint,
  components: Record<string, ComponentInstance>,
  connectors: Record<string, ConnectorInstance>,
): boolean {
  if (ep.component === undefined) {
    // A reference to a host-class port. If it names a known standalone
    // connector that gating removed, it's gone; otherwise keep it.
    return true;
  }
  const comp = components[ep.component];
  if (comp) {
    return !(comp.hiddenPorts?.includes(ep.port) ?? false);
  }
  // The root cref is a standalone connector instance (e.g. an exposed port
  // wired internally). Visible only if it survived gating.
  return connectors[ep.component] !== undefined;
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
  const style: LineStyle = {};
  const color = colorFromLine(line);
  if (color) style.color = color;
  const thickness = thicknessFromLine(line);
  if (thickness !== undefined) style.thickness = thickness;
  const pattern = patternFromLine(line);
  if (pattern) style.pattern = pattern;
  const arrow = arrowFromLine(line);
  if (arrow) style.arrow = arrow;
  const arrowSize = arrowSizeFromLine(line);
  if (arrowSize !== undefined) style.arrowSize = arrowSize;
  const smooth = smoothFromLine(line);
  if (smooth) style.smooth = smooth;
  return { lhs, rhs, waypoints, ...style };
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
  resolvedParameters?: Record<string, string>,
): DiagramLayout {
  const registry = newClassRegistry();
  // Graphic expressions address parameters by their path from the OPENED
  // class (`t.useSupport`), so every layer — host, ancestor, sub-component
  // type — reduces against this one scope rather than a local one.
  const scope = modelInstanceScope(mi);

  const iconLayers = collectLayers(mi, "icon", scope);
  const diagramLayers =
    kind === "diagram" ? collectLayers(mi, "diagram", scope) : [];
  const labels = kind === "diagram" ? collectLabels(mi, scope) : [];

  // Standalone connectors on the host class (and ancestors), inheritance-aware.
  const connectors: Record<string, ConnectorInstance> = {};
  for (const { element } of walkConnectors(mi)) {
    // Gate first — `if use_x` connectors are elided when OMC's
    // pre-reduced predicate is the literal `false`.
    if (!isConditionTrue(element.condition, scope)) continue;
    // Also seed the connector's class into the registry so consumers can
    // look up its own icon via `classes[connector.classRef]`.
    const inst = instanceFromConnector(element, kind, registry, scope);
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
    if (!isConditionTrue(el.condition, scope)) continue;
    const inst = instanceFromSubComponent(
      el,
      kind === "icon" ? "icon" : "diagram",
      registry,
      scope,
    );
    if (inst) components[inst.name] = inst;
  }
  // Same for any sub-components declared on ancestors. They DO show up
  // in PID-style examples sometimes (e.g., Modelica.Icons.Example doesn't
  // declare any, but other ancestors might). Walk the chain, skip the
  // host (already done) and skip duplicates.
  for (const { klass } of walkExtendsChain(mi)) {
    if (klass === mi) continue;
    for (const el of ownSubComponents(klass)) {
      if (components[el.name]) continue;
      if (!isConditionTrue(el.condition, scope)) continue;
      const inst = instanceFromSubComponent(
        el,
        kind === "icon" ? "icon" : "diagram",
        registry,
        scope,
      );
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
    // Walk the extends chain in post-order so ancestor connections paint
    // first and host-class equations sit on top — same ordering convention
    // as `iconLayers`. OMC keeps inherited equations under
    // `elements[$kind=extends].baseClass.connections`, never flattened; if
    // we read `mi.connections` alone, a derived class that purely extends
    // its base would render with zero edges.
    for (const { klass } of walkExtendsChain(mi)) {
      for (const c of klass.connections ?? []) {
        const cl = emitConnection(c);
        // Drop edges whose endpoint roots / ports were gated out of the
        // visible set (issue #76, item 6). A `connect(x.y, …)` to a
        // conditional component / port that OMC reduced away would
        // otherwise dangle to a non-existent node — we filter rather than
        // rely on OMC dropping the equation.
        if (
          cl &&
          endpointVisible(cl.lhs, components, connectors) &&
          endpointVisible(cl.rhs, components, connectors)
        ) {
          connections.push(cl);
        }
      }
    }
  }

  // Register the opened host class itself so `classes[mi.name]` carries the
  // host's own `parameters` (issue #76, item 10): the host-side displayUnit
  // pass walks `layout.classes`, but the registry was previously seeded only
  // from sub-component types — so `displayUnit` params declared ON the opened
  // model rendered in source units. `registerClass` is idempotent and walks
  // the host's extends chain for inherited parameters, matching the form.
  registerClass(mi, registry, scope);

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
    classes: Object.fromEntries(registry.defs),
    components,
    connectors,
    connections,
  };
  const cs = coordinateSystemForKind(mi, kind);
  if (cs) layout.coordinateSystem = cs;
  // Echo the resolved-parameter map onto the output so downstream
  // consumers (label substitution, post-fetch debug, future Dialog.enable
  // shared scope) don't need to re-fetch it.
  if (resolvedParameters !== undefined) {
    layout.resolvedParameters = resolvedParameters;
  }
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
