/**
 * Pure `ParameterModel` → flat field list normaliser for the parameter form.
 *
 * The webview renders omc-client's typed `ParameterModel` directly — no JSON
 * Schema, no `x-modelica-*` keys (see `docs/parameter-model-design.md`,
 * Revision 2026-05-21). `parameterFieldsFromModel` maps each
 * omc-client `ParameterField` onto the form's internal `ParameterField`, which
 * the renderer and the `Dialog.enable` evaluator consume.
 *
 * The vocabulary matches what the producers emit: scalars (`string` / `number`
 * / `integer` / `boolean`), enums, and a read-only `unsupported` fallback for
 * record / array / complex parameters we can't edit yet.
 *
 * Pure of Lit / DOM imports so it's testable with plain vitest.
 */

import type {
  Expression,
  ParameterField as ModelField,
  ParameterModel,
  UnitOption as ModelUnitOption,
} from "@dicode/omc-client";
// Sub-path import: the evaluator subtree only — the bare-name import
// above is type-only (erased at build) so neither path drags the OMC
// transport (zeromq / cmake-ts) into the webview bundle.
import {
  evaluateExpression,
  prefixStrippingScope,
  recordScope,
  type EvalScope,
  type EvalValue,
} from "@dicode/omc-client/eval";

export type FieldKind =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "color"
  | "array"
  | "unsupported";

/**
 * A selectable unit choice for a parameter, with the affine conversion
 * needed to render a `unit`-valued number in this option's unit.
 *
 * The factors are pre-computed HOST-SIDE (via the session-cached
 * `convertUnits(unit, option)`) and carried on the model so the webview
 * converts the shown value locally on dropdown change — no per-keystroke /
 * per-change OMC round-trip. Conversion direction matches OMEdit
 * (`ElementProperties.cpp`):
 *
 *   shownValue = (sourceValue - offset) / scaleFactor
 *
 * The entry whose `unit === field.unit` is the identity option
 * (`scaleFactor = 1`, `offset = 0`).
 */
export interface UnitOption {
  /** The unit string this option selects (e.g. "deg", "rad"). */
  unit: string;
  /** Affine scale: `shown = (source - offset) / scaleFactor`. */
  scaleFactor: number;
  /** Affine offset: `shown = (source - offset) / scaleFactor`. */
  offset: number;
}

export interface ParameterField {
  /** Property name (== model field name; submit values key on this). */
  name: string;
  /** Widget kind we want to render for this field. */
  kind: FieldKind;
  /**
   * True when the field must carry a value for the submit button to enable.
   * Editable parameters always carry a binding (modifier or type default), so
   * they're "required" in the form sense — keeps OK enabled without edits.
   * `unsupported` (read-only) fields are never required.
   */
  required: boolean;
  /**
   * The field's current resolved value (instance modifier over type default),
   * used to seed the form's working state. `null`/`undefined` → the form shows
   * a placeholder.
   */
  value: unknown;
  /** Type-declaration default, for reset / dirty-detection / enable fallback. */
  defaultValue: unknown;
  /** Human description — the declaration comment (else undefined). */
  description: string | undefined;
  /** Enum options when `kind === "enum"`. */
  enumValues: ReadonlyArray<string>;
  /** Element kind for `kind === "array"`. (Producers don't emit arrays yet.) */
  itemKind: FieldKind | undefined;
  /**
   * Modelica Dialog tab / group, from the model field's `dialog`. Always set
   * by the producers (spec §18.7 defaults).
   */
  tab: string | undefined;
  group: string | undefined;
  /**
   * Raw `Dialog.enable` expression AST. Evaluated by the form against live
   * working values so the control goes `disabled` when the condition is false.
   * `undefined` means "always enabled".
   */
  enable: Expression | undefined;
  /**
   * Qualified type name for enum fields. The form needs it to qualify a
   * leaf-name working value (`"PI"`) before equality-checking it against a
   * fully-qualified enum literal from a Dialog.enable expression.
   */
  enumTypeName: string | undefined;
  /**
   * Declaration unit (e.g. `"kg.m2"`, `"rad"`). `undefined` for unit-less
   * parameters. When set and `unitOptions` has a single entry, the form
   * renders it as a static suffix.
   */
  unit: string | undefined;
  /**
   * The component's `displayUnit` modifier. Default-selected in the unit
   * dropdown when it differs from `unit`, matching OMEdit.
   */
  displayUnit: string | undefined;
  /**
   * Pre-computed unit choices + conversion factors (from the model field's
   * `unitOptions`, filled host-side from the session-cached `UnitTable`).
   * Empty when the host didn't enrich the model (e.g. a unit-less param).
   * 1 entry → static suffix; ≥2 → dropdown.
   */
  unitOptions: ReadonlyArray<UnitOption>;
}

/**
 * Map a `ParameterModel` onto the form's internal field list. Field order
 * follows the model's (ancestors first, host last; or the simulate producer's
 * declared order). `unsupported` fields are kept so the form can show their
 * current binding read-only rather than silently dropping them.
 */
export function parameterFieldsFromModel(
  model: ParameterModel,
): ParameterField[] {
  return model.fields.map(fieldFromModelField);
}

function fieldFromModelField(f: ModelField): ParameterField {
  return {
    name: f.name,
    kind: f.kind,
    required: f.kind !== "unsupported",
    value: normaliseValue(f.value),
    defaultValue: f.defaultValue,
    description: f.label !== f.name ? f.label : undefined,
    enumValues: f.enumChoices ?? [],
    itemKind: undefined,
    tab: f.dialog.tab,
    group: f.dialog.group,
    enable: f.dialog.enable,
    enumTypeName: f.enumTypeName,
    unit: f.unit,
    displayUnit: f.displayUnit,
    unitOptions: f.unitOptions.map(unitOptionFromModel),
  };
}

/**
 * The producer leaves an unresolvable scalar as `null`; the form treats
 * `null` / `undefined` alike as "no usable value" (renders a placeholder).
 * Non-scalar `Expression` values (only on `unsupported` fields) are stringified
 * for the read-only display.
 */
function normaliseValue(v: ModelField["value"]): unknown {
  if (v === null) return undefined;
  if (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  ) {
    return v;
  }
  // An Expression AST on an unsupported field — show a stringified form.
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function unitOptionFromModel(o: ModelUnitOption): UnitOption {
  return { unit: o.unit, scaleFactor: o.scaleFactor, offset: o.offset };
}

/**
 * True when every required *and enabled* field has a usable value in
 * `values`.
 *
 * A disabled field (its `Dialog.enable` evaluates to `false`) is skipped
 * (issue #76, item 17): OMEdit greys such a field out and never submits it,
 * so a disabled required-but-empty field must not block the OK button. The
 * enabled check needs the full field list + the live committed values (and
 * an optional `crefPrefix` for sub-component forms) so it can reuse
 * `isFieldEnabled`'s evaluator.
 */
export function isComplete(
  fields: ReadonlyArray<ParameterField>,
  values: Record<string, unknown>,
  crefPrefix?: string,
): boolean {
  for (const f of fields) {
    if (!f.required) continue;
    if (!isFieldEnabled(f, fields, values, crefPrefix)) continue;
    const v = values[f.name];
    if (v === undefined || v === null || v === "") return false;
  }
  return true;
}

/**
 * Project the working `values` down to only the fields whose `Dialog.enable`
 * is currently true (issue #76, item 4).
 *
 * OMEdit suppresses writes for disabled fields: setting `Ti`, then flipping
 * `controllerType` to `P` (which disables `Ti`), then submitting must NOT
 * write the stale `Ti`. Dropping the key entirely lets the submit handler
 * treat it as "no edit" rather than a value to push to OMC. A field with no
 * `enable` (always enabled) is always kept.
 */
export function enabledValues(
  fields: ReadonlyArray<ParameterField>,
  values: Record<string, unknown>,
  crefPrefix?: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (!isFieldEnabled(f, fields, values, crefPrefix)) continue;
    out[f.name] = values[f.name];
  }
  return out;
}

/**
 * Build the initial `values` record by walking each field and picking its
 * resolved `value` (instance modifier over type default), falling back to the
 * type `defaultValue`. Fields with neither get `undefined`, so
 * `Object.keys(initialValues)` still includes them — the renderer can decide
 * whether to show a placeholder.
 */
export function initialValuesFromFields(
  fields: ReadonlyArray<ParameterField>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.value !== undefined && f.value !== null) {
      out[f.name] = f.value;
    } else if (f.defaultValue !== undefined && f.defaultValue !== null) {
      out[f.name] = f.defaultValue;
    } else {
      out[f.name] = undefined;
    }
  }
  return out;
}

// ── Dialog.enable evaluation ─────────────────────────────────────────
//
// Pure of Lit / DOM so the gating logic — including the value-fallback
// precedence — is unit-testable without mounting the WA-laden component.

/**
 * Compose the `EvalScope` a `Dialog.enable` expression is resolved
 * against, given a snapshot of the form's committed values.
 *
 * Per-field value precedence mirrors OMEdit's two-pass binding/value
 * evaluator (`OMEdit/OMEditLIB/Annotations/DynamicAnnotation.cpp:222-242`):
 *
 *   1. the field's committed working value (the live binding), then
 *   2. the field's class-default value (`field.defaultValue`), then
 *   3. omit the cref entirely → the evaluator's `{ fallback: true }`
 *      keeps the dependent field enabled.
 *
 * Step 2 is what keeps `enable = k > 0` working after the user clears
 * `k`: the cleared binding falls back to `k`'s default instead of
 * leaving the cref undefined.
 *
 * Enum values are qualified on the fly using the field's `enumTypeName`
 * so equality against a fully-qualified enum literal in the expression
 * works without the form having to qualify on every keystroke.
 *
 * `crefPrefix`, when set, is stripped off an initial cref segment so a
 * sub-component expression (`PI.controllerType == …`) resolves against
 * the form's bare `controllerType` value.
 */
export function buildEnableScope(
  fields: ReadonlyArray<ParameterField>,
  committed: Record<string, unknown>,
  crefPrefix?: string,
): EvalScope {
  const values: Record<string, EvalValue> = {};
  for (const f of fields) {
    const committedValue = committed[f.name];
    // Working value first, class default second. Either `undefined` or
    // `null` is treated as "no usable value" so a cleared field falls
    // through to its default.
    const v =
      committedValue !== undefined && committedValue !== null
        ? committedValue
        : f.defaultValue;
    if (v === undefined || v === null) continue;
    if (
      f.kind === "enum" &&
      typeof v === "string" &&
      f.enumTypeName !== undefined
    ) {
      values[f.name] = { $kind: "enum", name: `${f.enumTypeName}.${v}` };
    } else {
      values[f.name] = v as EvalValue;
    }
  }
  const base = recordScope(values);
  return crefPrefix ? prefixStrippingScope(crefPrefix, base) : base;
}

/**
 * Evaluate a field's `Dialog.enable` against `committed` values.
 *
 * Returns `true` when the field has no expression (always enabled),
 * when the expression evaluates to `true`, or when the evaluator can't
 * reduce it (default-enabled — same behaviour as if the annotation were
 * absent). Returns `false` only when the expression is a literal
 * `false` or evaluates to `false`.
 */
export function isFieldEnabled(
  field: ParameterField,
  fields: ReadonlyArray<ParameterField>,
  committed: Record<string, unknown>,
  crefPrefix?: string,
): boolean {
  if (field.enable === undefined) return true;
  if (field.enable === true) return true;
  if (field.enable === false) return false;
  const result = evaluateExpression(
    field.enable,
    buildEnableScope(fields, committed, crefPrefix),
    { fallback: true },
  );
  return result !== false;
}
