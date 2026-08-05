/**
 * Pure producer: `ModelInstance` (validated upstream by Zod) →
 * `ParameterModel` (renderer-agnostic). Sibling to `produceDiagramLayout`.
 *
 * No OMC contact, no rendering. The producer:
 *  1. Walks the (component's) type extends chain in post-order (ancestors
 *     first, host last), collecting `variability == "parameter"` elements.
 *     A more-derived re-declaration overrides the inherited entry by name,
 *     matching Modelica flattening / override semantics.
 *  2. Resolves each value as instance-modifier-over-type-default, classifying
 *     the field kind (scalar / enum / unsupported) off the (possibly aliased)
 *     declaration type.
 *  3. Reads the `Dialog(tab/group/enable)` annotation (spec §18.7 defaults).
 *  4. Pulls the base `unit` (from the type alias's `extends Real(unit=…)`
 *     chain) and the `displayUnit` modifier.
 *  5. Tags `inheritedFrom` for class params reached through `extends` — the
 *     host's DIRECT extends base, so the host-side write routes through
 *     `setExtendsModifierValue(host, directBase, …)` (not the deep declaring
 *     ancestor, which would be a no-op).
 *  6. When a `UnitTable` is injected, fills each unit-bearing field's
 *     `unitOptions` from it (deduplicated by base unit upstream).
 *
 * This REPLACES the extension's `buildComponentParameterForm` /
 * `buildClassParameterForm` + the `parameter-shape.ts` helpers; the
 * extension adapts the model into the webview `JsonSchema` in a thin layer.
 */

import type {
  Annotation,
  ComponentElement,
  Expression,
  ExtendsElement,
  Modifier,
  ModelInstance,
} from "../../_shared/modelInstance.js";
import type {
  ParameterField,
  ParameterModel,
  UnitOption,
  UnitTable,
} from "./types.js";
import { walkExtendsChain } from "../../_shared/extendsChain.js";
import {
  resolveDisplayUnit,
  resolveUnit,
  unquoteString,
} from "../../_shared/unitResolution.js";

/**
 * Modelica Dialog-annotation defaults — see spec §18.7. Surfaced even when
 * the source didn't spell them out so the form's grouping always has a key.
 */
export const DEFAULT_DIALOG_TAB = "General";
export const DEFAULT_DIALOG_GROUP = "Parameters";

export interface ProduceParameterModelOptions {
  /**
   * Sub-component instance name. When set, `instance` is treated as the
   * component's TYPE and the model describes that component's parameters
   * (`component` is echoed onto the output). When unset, `instance` is the
   * host class and the model describes its class-level parameters.
   */
  component?: string | undefined;
  /**
   * Injected unit table (host-fetched, session-cached). When present, fills
   * each unit-bearing field's `unitOptions`. Keyed by base unit.
   */
  unitTable?: UnitTable | undefined;
}

/**
 * Produce a `ParameterModel` for `instance`.
 *
 * For a class-level model (no `opts.component`), `instance` is the host class.
 * For a component-level model, pass the component's TYPE as `instance` and the
 * instance name as `opts.component`; per-instance modifier overrides should be
 * folded onto the type via the caller's `instance` (OMC's `getModelInstance`
 * already inlines them) — when they aren't, the type default is used.
 *
 * NOTE on component overrides: the extension passes the sub-component's
 * `component.type` (which carries the type defaults) and the parent-class
 * per-instance modifier record separately. To keep the producer pure and
 * single-argument-shaped, the host folds those overrides in via
 * `opts`-less `instance` editing OR — the path actually used — supplies the
 * overrides as the modifier record through `componentOverrides`.
 */
export function produceParameterModel(
  instance: ModelInstance,
  opts: ProduceParameterModelOptions & {
    /**
     * Parent-class per-instance modifier record for a sub-component
     * (`component.modifiers`). Each key is a parameter name; the value is the
     * override (a leaf, or a `{ $value }` wrapper). Only meaningful with
     * `component` set.
     */
    componentOverrides?: Modifier | undefined;
  } = {},
): ParameterModel {
  const overrides = opts.component
    ? readModifierRecord(opts.componentOverrides)
    : {};

  const fields: ParameterField[] = [];
  const indexByName = new Map<string, number>();

  for (const { klass, directBase } of walkExtendsChain(instance)) {
    // `instance` is the host (last in the post-order walk). Anything earlier
    // is an ancestor reached via `extends`, so its params are inherited.
    const inheritedFrom = klass === instance ? undefined : directBase;
    for (const el of klass.elements ?? []) {
      if (el.$kind !== "component") continue;
      if (el.prefixes?.variability !== "parameter") continue;
      const field = buildField(
        el,
        inheritedFrom,
        opts.component ? overrides[el.name] : undefined,
        opts.unitTable,
      );
      const existing = indexByName.get(el.name);
      if (existing !== undefined) {
        // More-derived re-declaration overrides the inherited entry, in place
        // (preserves first-seen order, last-write-wins on content) — matches
        // the form builders' last-write-wins-by-name semantics.
        fields[existing] = field;
      } else {
        indexByName.set(el.name, fields.length);
        fields.push(field);
      }
    }
  }

  const model: ParameterModel = {
    className: instance.name,
    fields,
  };
  if (opts.component !== undefined) model.component = opts.component;
  return model;
}

/**
 * Pure: the distinct base units referenced by a model's fields. The host uses
 * it to know which base units to resolve into the `UnitTable`. Skips empty and
 * the dimensionless `"1"` placeholder (no derived units / nothing to convert).
 */
export function collectBaseUnits(model: ParameterModel): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of model.fields) {
    const u = f.unit?.trim();
    if (!u || u === "1") continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

// ---------- field building ----------

function buildField(
  el: ComponentElement,
  inheritedFrom: string | undefined,
  override: Modifier | undefined,
  unitTable: UnitTable | undefined,
): ParameterField {
  const label = el.comment ?? el.name;
  const dialog = readDialogInfo(el.annotation);
  const unit = resolveUnit(el);
  const displayUnit = resolveDisplayUnit(el);

  const base: Omit<ParameterField, "kind" | "value"> = {
    name: el.name,
    label,
    dialog,
    unitOptions: unitOptionsFor(unit, unitTable),
  };
  if (unit !== undefined) base.unit = unit;
  if (displayUnit !== undefined) base.displayUnit = displayUnit;
  if (inheritedFrom !== undefined) base.inheritedFrom = inheritedFrom;
  // Untyped on the wire (`value: z.unknown()`), like Dialog.enable; consumers
  // of the AST (expressionToString) are total over unknown shapes.
  const binding = readValueBinding(el.value);
  if (binding !== undefined && binding !== null) {
    base.binding = binding as Expression;
  }

  const enumChoices = enumLeavesIfEnum(el.type);
  if (enumChoices) {
    const qualified = typeQualifiedName(el.type);
    if (qualified) {
      const value = enumCurrentLeaf(el, qualified, override);
      const defaultValue = enumDefaultLeaf(el, qualified);
      const field: ParameterField = {
        ...base,
        kind: "enum",
        value: value ?? null,
        enumChoices,
        enumTypeName: qualified,
      };
      if (defaultValue !== undefined) field.defaultValue = defaultValue;
      return field;
    }
    // Enum with no qualified name → fall through to unsupported.
  }

  const primitive = resolvePrimitive(el.type);
  if (primitive) {
    const value = currentPrimitiveValue(el, primitive, override);
    const defaultValue = defaultPrimitiveValue(el, primitive);
    const field: ParameterField = {
      ...base,
      kind: primitive,
      value: value ?? null,
    };
    if (defaultValue !== undefined) field.defaultValue = defaultValue;
    return field;
  }

  // Unsupported (record / array / complex) — surface the current binding
  // read-only so the user at least sees what's there.
  const display = renderCurrentBinding(el);
  return {
    ...base,
    kind: "unsupported",
    value: display,
  };
}

// ---------- type-shape resolution (was parameter-shape.ts) ----------

type PrimitiveKind = "number" | "integer" | "boolean" | "string";

/**
 * Walk a (possibly aliased) Modelica type to one of the four primitive roots.
 * The aliasing pattern is `type Angle = Real(unit="rad")`, so we follow the
 * first `extends` of each non-primitive type. Depth-limited (8) against cycles.
 */
function resolvePrimitive(
  type: ComponentElement["type"],
): PrimitiveKind | undefined {
  if (type === undefined) return undefined;
  if (typeof type === "string") return primitiveOf(type);
  let cursor: ModelInstance | string | undefined = type;
  for (let i = 0; i < 8; i += 1) {
    if (cursor === undefined) return undefined;
    if (typeof cursor === "string") return primitiveOf(cursor);
    const mi: ModelInstance = cursor;
    if (!Array.isArray(mi.elements)) return undefined;
    let ext: ExtendsElement | undefined;
    for (const e of mi.elements) {
      if (e.$kind === "extends") {
        ext = e;
        break;
      }
    }
    if (!ext) return primitiveOf(mi.name);
    cursor = ext.baseClass;
  }
  return undefined;
}

function primitiveOf(name: string | undefined): PrimitiveKind | undefined {
  switch (name) {
    case "Real":
      return "number";
    case "Integer":
      return "integer";
    case "Boolean":
      return "boolean";
    case "String":
      return "string";
    default:
      return undefined;
  }
}

/**
 * Detect an enumeration type and return its leaf names in declaration order.
 * Enum types extend the special `enumeration` baseClass and list their literals
 * as bare `component` elements with no variability prefix.
 */
function enumLeavesIfEnum(
  type: ComponentElement["type"],
): string[] | undefined {
  if (!type || typeof type === "string") return undefined;
  const elements = type.elements ?? [];
  const extendsEnumeration = elements.some(
    (e) => e.$kind === "extends" && e.baseClass === "enumeration",
  );
  if (!extendsEnumeration) return undefined;
  const leaves: string[] = [];
  for (const e of elements) {
    if (e.$kind === "component") leaves.push(e.name);
  }
  return leaves.length > 0 ? leaves : undefined;
}

function typeQualifiedName(type: ComponentElement["type"]): string | undefined {
  if (!type || typeof type === "string") return undefined;
  return type.name;
}

// ---------- unit options ----------

/**
 * Build the field's unit option list from an injected table. Empty when no
 * table, no unit, or the table has no entry for the base unit.
 */
function unitOptionsFor(
  unit: string | undefined,
  unitTable: UnitTable | undefined,
): ReadonlyArray<UnitOption> {
  if (unit === undefined || unitTable === undefined) return [];
  return unitTable.get(unit) ?? [];
}

// ---------- value resolution ----------

/**
 * Resolve an enum parameter's current leaf. Lookup order:
 *  1. Parent-class override (`component.modifiers[paramName]`) — when it's a
 *     string like `"Modelica.Blocks.Types.SimpleController.PI"`.
 *  2. Type-declaration default (`el.value.binding` if tagged enum).
 *  3. The bare modifier on the type-side element, when present.
 */
function enumCurrentLeaf(
  el: ComponentElement,
  qualified: string,
  override: Modifier | undefined,
): string | undefined {
  const overrideValue = readLeafModifier(override);
  if (typeof overrideValue === "string") {
    return stripPrefix(overrideValue, qualified);
  }
  return enumDefaultLeaf(el, qualified);
}

/** The enum leaf from the type declaration only (no instance override). */
function enumDefaultLeaf(
  el: ComponentElement,
  qualified: string,
): string | undefined {
  const binding = readValueBinding(el.value);
  if (binding && typeof binding === "object" && !Array.isArray(binding)) {
    const tagged = binding as { $kind?: unknown; name?: unknown };
    if (tagged.$kind === "enum" && typeof tagged.name === "string") {
      return stripPrefix(tagged.name, qualified);
    }
  }
  const mod = el.modifiers;
  if (typeof mod === "string") return stripPrefix(mod, qualified);
  return undefined;
}

/**
 * Resolve a scalar parameter's current value. Preference order:
 *  1. Parent-class override on this component.
 *  2. Type-declaration's evaluated literal (`el.value.value`).
 *  3. Type-declaration's binding (when primitive).
 *  4. Type-declaration's bare modifier expression.
 */
function currentPrimitiveValue(
  el: ComponentElement,
  kind: PrimitiveKind,
  override: Modifier | undefined,
): string | number | boolean | undefined {
  const overrideValue = readLeafModifier(override);
  if (overrideValue !== undefined) {
    return coerceToKind(
      kind === "string" && typeof overrideValue === "string"
        ? unquoteString(overrideValue)
        : overrideValue,
      kind,
    );
  }
  return defaultPrimitiveValue(el, kind);
}

/** The scalar value from the type declaration only (no instance override). */
function defaultPrimitiveValue(
  el: ComponentElement,
  kind: PrimitiveKind,
): string | number | boolean | undefined {
  const evaluated = readValueLiteral(el.value);
  if (evaluated !== undefined) return coerceToKind(evaluated, kind);
  const binding = readValueBinding(el.value);
  if (
    typeof binding === "number" ||
    typeof binding === "boolean" ||
    typeof binding === "string"
  ) {
    return coerceToKind(binding, kind);
  }
  const mod = el.modifiers;
  if (typeof mod === "string") {
    return coerceToKind(kind === "string" ? unquoteString(mod) : mod, kind);
  }
  return undefined;
}

/**
 * Coerce a raw value into the field kind. Returns `undefined` for
 * un-coercible inputs so the caller can fall back to a placeholder.
 */
function coerceToKind(
  raw: unknown,
  kind: PrimitiveKind,
): string | number | boolean | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (kind === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") return raw === "true";
    return undefined;
  }
  if (kind === "number" || kind === "integer") {
    if (typeof raw === "number") return raw;
    if (typeof raw === "string") {
      const n = kind === "integer" ? parseInt(raw, 10) : Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  }
  if (typeof raw === "string") return raw;
  return String(raw);
}

/**
 * Best-effort one-line stringification for a parameter's current binding —
 * used for the read-only display of "unsupported" parameters.
 */
function renderCurrentBinding(el: ComponentElement): string {
  const v = el.value;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const evaluated = (v as { value?: unknown }).value;
    if (evaluated !== undefined && evaluated !== null) {
      return stringifyForDisplay(evaluated);
    }
    const binding = (v as { binding?: unknown }).binding;
    if (binding !== undefined && binding !== null) {
      return stringifyForDisplay(binding);
    }
  }
  if (el.modifiers !== undefined) {
    return stringifyForDisplay(el.modifiers as Modifier);
  }
  return "";
}

function stringifyForDisplay(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  ) {
    return String(v);
  }
  if (typeof v === "object") {
    const obj = v as { $kind?: unknown; name?: unknown };
    if (obj.$kind === "enum" && typeof obj.name === "string") {
      return obj.name;
    }
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

// ---------- Dialog annotation ----------

function readDialogInfo(annotation: Annotation | undefined): {
  tab: string;
  group: string;
  enable?: Expression | undefined;
} {
  if (!annotation) {
    return { tab: DEFAULT_DIALOG_TAB, group: DEFAULT_DIALOG_GROUP };
  }
  const dlg = (annotation as { Dialog?: unknown }).Dialog;
  if (!dlg || typeof dlg !== "object" || Array.isArray(dlg)) {
    return { tab: DEFAULT_DIALOG_TAB, group: DEFAULT_DIALOG_GROUP };
  }
  const obj = dlg as { tab?: unknown; group?: unknown; enable?: unknown };
  const out: { tab: string; group: string; enable?: Expression | undefined } = {
    tab: typeof obj.tab === "string" ? obj.tab : DEFAULT_DIALOG_TAB,
    group: typeof obj.group === "string" ? obj.group : DEFAULT_DIALOG_GROUP,
  };
  // `enable` is plain JSON (a literal boolean or an Expression AST). Pass it
  // through untouched; the form's evaluator handles every shape. Only set the
  // key when present so own-vs-enable refs stay clean.
  if (obj.enable !== undefined) out.enable = obj.enable as Expression;
  return out;
}

// ---------- modifier / value readers ----------

function readModifierRecord(mod: unknown): Record<string, Modifier> {
  if (!mod || typeof mod !== "object" || Array.isArray(mod)) return {};
  return mod as Record<string, Modifier>;
}

/**
 * Extract the leaf value from a single modifier:
 *  - bare string / number / boolean → used directly
 *  - object with `$value` → that's the binding
 *  - nested record with no `$value` → `undefined` (addresses a deeper param)
 */
function readLeafModifier(m: Modifier | undefined): unknown {
  if (m === undefined || m === null) return undefined;
  if (
    typeof m === "string" ||
    typeof m === "number" ||
    typeof m === "boolean"
  ) {
    return m;
  }
  if (typeof m === "object" && !Array.isArray(m)) {
    const v = (m as { $value?: unknown }).$value;
    if (v !== undefined) return v;
  }
  return undefined;
}

function readValueLiteral(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return (value as { value?: unknown }).value;
}

function readValueBinding(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return (value as { binding?: unknown }).binding;
}

// ---------- string helpers ----------

function stripPrefix(name: string, qualified: string): string {
  const prefix = `${qualified}.`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/** For tests / external introspection — kept off the public barrel. */
export const _internal = {
  resolvePrimitive,
  enumLeavesIfEnum,
  readDialogInfo,
};
