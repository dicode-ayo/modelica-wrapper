/**
 * Submit-side helpers for the parameter modals — value→expression encoding,
 * per-field edit plans, write-target routing, and the `ParameterRef` map the
 * submit handler diffs against.
 *
 * The webview now renders omc-client's `ParameterModel` directly (no
 * host-side `ParameterModel → JsonSchema` adapter — that module was removed,
 * see `docs/parameter-model-design.md`, Revision 2026-05-21). The host still
 * needs, on submit, the per-field metadata to translate a returned form value
 * back into a Modelica expression and to target the right `elementName`; that
 * metadata is derived straight from the same `ParameterModel` here.
 *
 * Pure of vscode / dom imports — tested with plain modelInstance JSON.
 */

import {
  produceParameterModel,
  type ComponentElement,
  type ModelInstance,
  type ParameterField,
  type ParameterModel,
  type UnitTable,
} from "@dicode/omc-client";

/** Modelica primitive kinds the modal can edit. Mirrors the producer's kinds. */
export type PrimitiveKind = "number" | "integer" | "boolean" | "string";

/**
 * Per-field metadata the submit handler needs to translate a form value back
 * into a Modelica expression and target the right `elementName`.
 *
 * Shared by the class- and component-level forms; the only difference is how
 * the submit handler uses `inheritedFrom` (class params route the write through
 * `setExtendsModifierValue`, component params always use the dotted path).
 */
export interface ParameterRef {
  /** Property name (== model field name). */
  name: string;
  /** Modelica type kind; `"unsupported"` is shown read-only. */
  kind: PrimitiveKind | "enum" | "color" | "unsupported";
  /** Qualified enum type name, for `kind === "enum"` (emits `<typeName>.<leaf>`). */
  enumTypeName?: string;
  /** Dialog tab / group — spec defaults ("General" / "Parameters"). */
  tab: string;
  group: string;
  /**
   * Qualified name of the host's DIRECT extends base this param is inherited
   * through, when reached via `extends` rather than declared on the host. Set
   * only for inherited params. Class submit routes through
   * `setExtendsModifierValue(host, inheritedFrom, …)`; component submit ignores
   * it (always the dotted `<component>.<param>` path).
   */
  inheritedFrom?: string;
}

/** Back-compat aliases — these names are referenced across the codebase/tests. */
export type ClassParameterRef = ParameterRef;
export type ComponentParameterRef = ParameterRef;

/** The state the host keeps to drive a parameter-modal submit. */
export interface ParameterFormState {
  /** The model the webview renders. */
  model: ParameterModel;
  /** Per-field submit metadata, keyed by name. */
  refs: Record<string, ParameterRef>;
  /** Initial values keyed by name — the submit diff baseline. */
  values: Record<string, unknown>;
}

export interface ComponentParameterFormState extends ParameterFormState {
  /** Echoed back to the submit handler so it knows which sub-component to address. */
  componentName: string;
}

/** Per-field submit ref derived from a model field. */
function refForField(field: ParameterField): ParameterRef {
  const ref: ParameterRef = {
    name: field.name,
    kind: field.kind,
    tab: field.dialog.tab,
    group: field.dialog.group,
  };
  if (field.kind === "enum" && field.enumTypeName !== undefined) {
    ref.enumTypeName = field.enumTypeName;
  }
  if (field.inheritedFrom !== undefined)
    ref.inheritedFrom = field.inheritedFrom;
  return ref;
}

/**
 * The host's submit-diff baseline value for a field — the producer's resolved
 * `value` (instance modifier over default). A `null` resolution means "no
 * usable value" → omit the key so the diff treats a first edit as a change.
 * Unsupported fields carry their read-only display string.
 */
function valueForField(field: ParameterField): unknown {
  if (field.kind === "unsupported") {
    return typeof field.value === "string" ? field.value : "";
  }
  if (field.value === null) return undefined;
  return field.value;
}

/** Build the `{ refs, values }` submit state from a `ParameterModel`. */
function stateFromModel(model: ParameterModel): {
  refs: Record<string, ParameterRef>;
  values: Record<string, unknown>;
} {
  const refs: Record<string, ParameterRef> = {};
  const values: Record<string, unknown> = {};
  for (const field of model.fields) {
    refs[field.name] = refForField(field);
    const value = valueForField(field);
    if (value !== undefined) values[field.name] = value;
  }
  return { refs, values };
}

/**
 * Build the modal state for the active class's top-level parameters. Returns
 * `undefined` when no editable parameters exist anywhere in the extends chain.
 *
 * `unitTable`, when supplied, fills each unit-bearing field's option list so
 * the webview renders the unit dropdown and converts locally — no per-change
 * OMC round-trip.
 */
export function buildClassParameterForm(
  instance: ModelInstance,
  unitTable?: UnitTable,
): ParameterFormState | undefined {
  const model = produceParameterModel(instance, { unitTable });
  if (model.fields.length === 0) return undefined;
  return { model, ...stateFromModel(model) };
}

/**
 * Build the modal state for a sub-component's parameters. Returns `undefined`
 * when the component has no inspectable type or no editable parameters.
 *
 * Sourced from the component's TYPE (the declaration site), with the parent
 * class's per-instance modifier record (`component.modifiers`) taking
 * precedence over the type's own defaults.
 */
export function buildComponentParameterForm(
  component: ComponentElement,
  unitTable?: UnitTable,
): ComponentParameterFormState | undefined {
  const type = component.type;
  if (!type || typeof type === "string") return undefined;
  const model = produceParameterModel(type, {
    component: component.name,
    componentOverrides: component.modifiers,
    unitTable,
  });
  if (model.fields.length === 0) return undefined;
  return { model, ...stateFromModel(model), componentName: component.name };
}

/**
 * Look up a sub-component by `name` on the class's `ModelInstance`. Returns
 * `undefined` when no component matches.
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

// ---------- value → expression encoding (submit) ----------

/**
 * Translate a single submitted form value into the Modelica expression
 * `setElementModifierValue` / `setExtendsModifierValue` expect:
 *  - numbers / booleans → their literal form (`12`, `true`)
 *  - strings → wrapped in `"..."` (escaped)
 *  - enums → `<qualified>.<leaf>`
 *  - `unsupported` → always `""` (never written; caller also filters)
 *  - `undefined` / `""` → empty string (caller treats as "clear")
 */
export function valueToExpr(
  kind: PrimitiveKind | "enum" | "color" | "unsupported",
  value: unknown,
  enumTypeName?: string,
): string {
  if (kind === "unsupported") return "";
  if (value === undefined || value === null || value === "") return "";
  switch (kind) {
    case "boolean":
      return value === true || value === "true" ? "true" : "false";
    case "number":
    case "integer":
      return String(value);
    case "string":
      return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    case "enum":
      if (!enumTypeName) return String(value);
      return `${enumTypeName}.${String(value)}`;
    case "color":
      return String(value);
  }
}

export function classParameterValueToExpr(
  ref: ParameterRef,
  value: unknown,
): string {
  return valueToExpr(ref.kind, value, ref.enumTypeName);
}

export function componentParameterValueToExpr(
  ref: ParameterRef,
  value: unknown,
): string {
  return valueToExpr(ref.kind, value, ref.enumTypeName);
}

/**
 * Build the dotted `elementName` `setElementModifierValue` expects for a
 * sub-component parameter (e.g. `PI.k`).
 */
export function componentParameterElementName(
  componentName: string,
  paramName: string,
): string {
  return `${componentName}.${paramName}`;
}

/** A single per-field `setElementModifierValue` write the submit will issue. */
export interface ComponentParameterEdit {
  /** Dotted modifier path on the host class, e.g. `PI.k`. */
  elementName: string;
  /** New modifier expression; `""` clears just this one modifier. */
  expr: string;
}

/**
 * Plan the per-field modifier writes for a sub-component parameter-form submit
 * (issue #76, item 1). One `{ elementName, expr }` per *changed* surfaced
 * parameter; an empty `expr` clears exactly that one modifier. NEVER plans a
 * bulk `removeElementModifiers` — see the call site in `open-diagram.ts`.
 */
export function componentParameterEditPlan(
  componentName: string,
  refs: Record<string, ParameterRef>,
  initialValues: Record<string, unknown>,
  submitted: Record<string, unknown>,
): ComponentParameterEdit[] {
  const plan: ComponentParameterEdit[] = [];
  for (const [name, ref] of Object.entries(refs)) {
    if (ref.kind === "unsupported") continue;
    if (sameParameterValue(initialValues[name], submitted[name])) continue;
    plan.push({
      elementName: componentParameterElementName(componentName, name),
      expr: componentParameterValueToExpr(ref, submitted[name]),
    });
  }
  return plan;
}

/** Equality that treats two `NaN`s (blank numeric fields) as unchanged. */
function sameParameterValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return (
    typeof a === "number" &&
    typeof b === "number" &&
    Number.isNaN(a) &&
    Number.isNaN(b)
  );
}
