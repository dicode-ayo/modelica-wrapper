/**
 * Helpers that turn a sub-component (e.g. the `PI` controller inside
 * `Modelica.Blocks.Examples.PID_Controller`) into the `{schema, values}`
 * pair the parameter modal renders.
 *
 * Differences from the class-level builder:
 *  - The parameter list is sourced from the component's *type*
 *    (`component.type.elements`) — the declaration site.
 *  - Initial values prefer the parent class's per-instance override
 *    (`component.modifiers[paramName]`) before falling back to the
 *    type's own default value.
 *  - Submit writes go through `setElementModifierValue` with
 *    `elementName = "<componentName>.<paramName>"` — the dotted path
 *    OMC uses to address a nested modifier.
 *
 * Pure of vscode / dom imports — tested with plain modelInstance JSON.
 */

import type {
  ComponentElement,
  JsonSchema,
  Modifier,
  ModelInstance,
} from "@modelica-wrapper/omc-client";

import {
  coerceToKind,
  enumLeavesIfEnum,
  readDialogInfo,
  renderCurrentBinding,
  resolvePrimitive,
  stripPrefix,
  typeQualifiedName,
  unquoteString,
  valueToExpr,
  type DialogInfo,
  type PrimitiveKind,
} from "./parameter-shape.js";

export interface ComponentParameterRef {
  /**
   * Local parameter name on the component's type. Form schema is keyed
   * by this; the submit handler builds the OMC `elementName` as
   * `<componentName>.<name>`.
   */
  name: string;
  /**
   * `"unsupported"` covers record / complex parameters we can't edit
   * yet — surfaced read-only on the form rather than dropped.
   */
  kind: PrimitiveKind | "enum" | "unsupported";
  enumTypeName?: string;
  tab: string;
  group: string;
  /**
   * Qualified TypeName of the ancestor that declares this parameter when
   * it's reached through the component type's `extends` chain rather than
   * declared on the component's own type. Absent for parameters declared
   * directly on the component's type.
   *
   * NOTE: this routing applies to *class-level* (top-level) parameter
   * edits. For sub-component edits the modifier is always written on the
   * parent class against the dotted `<component>.<param>` path — OMC
   * resolves the inherited parameter through the component type — so the
   * submit handler ignores `inheritedFrom` in that case. The field is
   * carried for parity / future use and to make the inheritance source
   * inspectable.
   */
  inheritedFrom?: string;
}

export interface ComponentParameterForm {
  schema: JsonSchema;
  values: Record<string, unknown>;
  refs: Record<string, ComponentParameterRef>;
  /** Echoed back to the submit handler so it knows which sub-component to address. */
  componentName: string;
}

/**
 * Build the modal payload for `component`. Returns `undefined` when
 * the component has no inspectable type (primitive-typed leaves, types
 * with no parameter declarations, etc.) — the caller should fall back
 * to a "no parameters" hint.
 */
export function buildComponentParameterForm(
  component: ComponentElement,
): ComponentParameterForm | undefined {
  const type = component.type;
  if (!type || typeof type === "string") return undefined;

  const overrides = readModifierRecord(component.modifiers);

  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const values: Record<string, unknown> = {};
  const refs: Record<string, ComponentParameterRef> = {};

  // Walk the type's extends chain in post-order (ancestors first, type
  // last) so a parameter that the type redeclares overrides the
  // inherited entry. Mirrors `buildClassParameterForm` — without this,
  // parameters declared on a parent class (e.g. `useSupport` on
  // `PartialElementaryOneFlangeAndSupport2`, ancestor of every
  // `Modelica.Mechanics.Rotational.Sources.*`) never surface in the
  // sub-component panel.
  for (const klass of walkExtendsChain(type)) {
    // `type` is the component's own type (last in the post-order walk).
    // Anything earlier is an ancestor reached via `extends`, so its
    // parameters are inherited into the component's type. Identity-safe
    // because the walker yields the same object references.
    const inheritedFrom = klass === type ? undefined : klass.name;
    for (const el of klass.elements ?? []) {
      if (el.$kind !== "component") continue;
      if (el.prefixes?.variability !== "parameter") continue;
      const built = buildField(el, overrides[el.name], inheritedFrom);
      properties[el.name] = built.schema;
      refs[el.name] = built.ref;
      if (built.value !== undefined) values[el.name] = built.value;
      if (built.ref.kind !== "unsupported") {
        if (!required.includes(el.name)) required.push(el.name);
      }
    }
  }

  if (Object.keys(properties).length === 0) return undefined;
  return {
    schema: { type: "object", properties, required },
    values,
    refs,
    componentName: component.name,
  };
}

/**
 * Post-order walk over `mi` and its `extends` ancestors. Same shape as
 * `class-parameter-form.ts`'s walker — kept local to avoid pulling that
 * file's exports across the form boundary. Ancestors are yielded first,
 * host last, matching Modelica flattening order.
 */
function* walkExtendsChain(mi: ModelInstance): Iterable<ModelInstance> {
  for (const e of mi.elements ?? []) {
    if (e.$kind === "extends" && typeof e.baseClass === "object") {
      yield* walkExtendsChain(e.baseClass);
    }
  }
  yield mi;
}

interface BuiltField {
  schema: JsonSchema;
  value: unknown;
  ref: ComponentParameterRef;
}

function buildField(
  el: ComponentElement,
  override: Modifier | undefined,
  inheritedFrom: string | undefined,
): BuiltField {
  const description = el.comment ?? undefined;
  const dialog: DialogInfo = readDialogInfo(el.annotation);
  const enumLeaves = enumLeavesIfEnum(el.type);
  if (enumLeaves) {
    const qualified = typeQualifiedName(el.type);
    if (qualified) {
      const schema: JsonSchema = {
        type: "string",
        enum: enumLeaves,
        ...dialogSchemaExt(dialog),
        "x-modelica-enum-type": qualified,
      };
      if (description) schema.description = description;
      return {
        schema,
        value: enumCurrentLeaf(el, qualified, override),
        ref: {
          name: el.name,
          kind: "enum",
          enumTypeName: qualified,
          tab: dialog.tab,
          group: dialog.group,
          ...inheritedRefField(inheritedFrom),
        },
      };
    }
  }
  const primitive = resolvePrimitive(el.type);
  if (primitive) {
    const schema: JsonSchema = {
      type: primitive,
      ...dialogSchemaExt(dialog),
    };
    if (description) schema.description = description;
    return {
      schema,
      value: currentPrimitiveValue(el, primitive, override),
      ref: {
        name: el.name,
        kind: primitive,
        tab: dialog.tab,
        group: dialog.group,
        ...inheritedRefField(inheritedFrom),
      },
    };
  }
  // Unsupported (record / array / complex) — show the current binding
  // read-only so the user at least sees what's there.
  const display = renderCurrentBinding(el);
  const schema: JsonSchema = {
    default: display,
    ...dialogSchemaExt(dialog),
  };
  if (description) schema.description = description;
  return {
    schema,
    value: display,
    ref: {
      name: el.name,
      kind: "unsupported",
      tab: dialog.tab,
      group: dialog.group,
      ...inheritedRefField(inheritedFrom),
    },
  };
}

/** See `class-parameter-form.ts` — same omit-when-undefined helper. */
function inheritedRefField(
  inheritedFrom: string | undefined,
): { inheritedFrom?: string } {
  return inheritedFrom === undefined ? {} : { inheritedFrom };
}

/** Same extension-key set as the class-level builder. See its `dialogSchemaExt`. */
function dialogSchemaExt(d: DialogInfo): Record<string, unknown> {
  const out: Record<string, unknown> = {
    "x-modelica-tab": d.tab,
    "x-modelica-group": d.group,
  };
  if (d.enable !== undefined) {
    out["x-modelica-enable"] = d.enable;
  }
  return out;
}

/**
 * Resolve an enum parameter's current leaf. Lookup order:
 *  1. Parent class override (`component.modifiers[paramName]`) — when
 *     it's a string like `"Modelica.Blocks.Types.SimpleController.PI"`.
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
 *  1. Parent class override on this component.
 *  2. Type-declaration's evaluated literal (`el.value.value`).
 *  3. Type-declaration's binding (when primitive).
 *  4. Type-declaration's bare modifier expression.
 */
function currentPrimitiveValue(
  el: ComponentElement,
  kind: PrimitiveKind,
  override: Modifier | undefined,
): unknown {
  const overrideValue = readLeafModifier(override);
  if (overrideValue !== undefined) {
    return coerceToKind(
      kind === "string" && typeof overrideValue === "string"
        ? unquoteString(overrideValue)
        : overrideValue,
      kind,
    );
  }
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
 * Normalize a `component.modifiers` value into a flat record keyed by
 * parameter name. The schema permits booleans / primitives at the top
 * level (rare, but valid), so we only treat plain-object shapes as
 * usable; anything else yields an empty record and the form falls
 * back to type-side defaults.
 */
function readModifierRecord(mod: unknown): Record<string, Modifier> {
  if (!mod || typeof mod !== "object" || Array.isArray(mod)) return {};
  return mod as Record<string, Modifier>;
}

/**
 * Extract the leaf value from a single modifier. Three shapes:
 *  - bare string / number / boolean → used directly
 *  - object with `$value` key → that's the binding (siblings carry
 *    `final` / `each` flags we ignore for the form)
 *  - nested record with no `$value` → returns `undefined` because that
 *    addresses a *deeper* parameter, not this one; surfacing it would
 *    require the recursive form layout we don't render yet.
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

export function componentParameterValueToExpr(
  ref: ComponentParameterRef,
  value: unknown,
): string {
  return valueToExpr(ref.kind, value, ref.enumTypeName);
}

/**
 * Look up a sub-component by `name` on the class's `ModelInstance`.
 * Returns `undefined` when no component matches (e.g. the user
 * double-clicked a connector or an annotation — neither carries a
 * typed `component` element on the host class).
 */
export function findSubComponent(
  instance: ModelInstance,
  name: string,
): ComponentElement | undefined {
  for (const el of instance.elements ?? []) {
    if (el.$kind === "component" && el.name === name) return el;
  }
  return undefined;
}

/**
 * Build the dotted `elementName` `setElementModifierValue` expects for
 * a sub-component parameter (e.g. `PI.k`). Kept as a one-liner helper
 * so the call site reads cleanly and any future quoting / escaping
 * (Modelica identifiers with `'…'` syntax, array subscripts) lives in
 * one place.
 */
export function componentParameterElementName(
  componentName: string,
  paramName: string,
): string {
  return `${componentName}.${paramName}`;
}
