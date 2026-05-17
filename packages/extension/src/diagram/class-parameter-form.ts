/**
 * Helpers that turn the active class's `ModelInstance` into the
 * `{schema, values}` pair the parameter modal renders.
 *
 * Scope of this first cut:
 *  - Top-level (own) parameters only — inherited parameters from `extends`
 *    aren't surfaced yet. The form vocabulary is the small one
 *    `<om-parameter-form>` already understands (scalar number / integer
 *    / boolean / string + enum picker); types outside that vocabulary
 *    are skipped so the form doesn't show widgets it can't drive.
 *
 * Pure of vscode / dom imports — tested with plain modelInstance JSON.
 */

import type {
  ComponentElement,
  JsonSchema,
  ModelInstance,
} from "@modelica-wrapper/omc-client";

import {
  coerceToKind,
  enumLeavesIfEnum,
  resolvePrimitive,
  stripPrefix,
  typeQualifiedName,
  unquoteString,
  valueToExpr,
  type PrimitiveKind,
} from "./parameter-shape.js";

/**
 * Per-field metadata the submit handler needs to translate a form value
 * back into a Modelica expression and target the right `elementName`
 * on `setElementModifierValue`. Kept alongside the schema so the
 * round-trip stays self-contained — the panel layer only sees a
 * `JsonSchema` + values record, and the submit side reads this map to
 * decide what string to send to OMC.
 */
export interface ClassParameterRef {
  /** Property name (== schema key, == component name on the host class). */
  name: string;
  /** Modelica type kind we resolved this parameter to. */
  kind: PrimitiveKind | "enum";
  /**
   * For enums, the qualified type name (e.g. `Modelica.Blocks.Types.Init`)
   * so we can emit `<typeName>.<leaf>` as the value expression.
   */
  enumTypeName?: string;
}

export interface ClassParameterForm {
  schema: JsonSchema;
  values: Record<string, unknown>;
  /** Per-property metadata keyed by name; used by the submit translator. */
  refs: Record<string, ClassParameterRef>;
}

/**
 * Walk the class's own elements and emit one schema property per
 * scalar/enum parameter. Returns `undefined` if no editable parameters
 * were found — the caller should show a "no parameters" hint rather
 * than open an empty modal.
 */
export function buildClassParameterForm(
  instance: ModelInstance,
): ClassParameterForm | undefined {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const values: Record<string, unknown> = {};
  const refs: Record<string, ClassParameterRef> = {};

  for (const el of instance.elements ?? []) {
    if (el.$kind !== "component") continue;
    if (el.prefixes?.variability !== "parameter") continue;
    const built = buildField(el);
    if (!built) continue;
    properties[el.name] = built.schema;
    refs[el.name] = built.ref;
    if (built.value !== undefined) values[el.name] = built.value;
    // Parameters always have a binding (either inherited default or the
    // user's modifier) so they're "required" in the form sense — the
    // submit button stays enabled even without edits.
    required.push(el.name);
  }

  if (Object.keys(properties).length === 0) return undefined;
  return {
    schema: { type: "object", properties, required },
    values,
    refs,
  };
}

interface BuiltField {
  schema: JsonSchema;
  value: unknown;
  ref: ClassParameterRef;
}

function buildField(el: ComponentElement): BuiltField | undefined {
  const description = el.comment ?? undefined;
  const enumLeaves = enumLeavesIfEnum(el.type);
  if (enumLeaves) {
    const qualified = typeQualifiedName(el.type);
    if (!qualified) return undefined;
    const schema: JsonSchema = { type: "string", enum: enumLeaves };
    if (description) schema.description = description;
    return {
      schema,
      value: enumCurrentLeaf(el, qualified),
      ref: { name: el.name, kind: "enum", enumTypeName: qualified },
    };
  }
  const primitive = resolvePrimitive(el.type);
  if (!primitive) return undefined;
  const schema: JsonSchema = { type: primitive };
  if (description) schema.description = description;
  return {
    schema,
    value: currentPrimitiveValue(el, primitive),
    ref: { name: el.name, kind: primitive },
  };
}

/**
 * Resolve the current value of an enum-typed parameter to its leaf
 * (e.g. `"PI"`), stripping the qualified type prefix so the picker
 * options match. The evaluated form is preferred (`value.binding`
 * carries a tagged `enum` literal); we fall back to parsing `modifiers`
 * as a string `<qualified>.<leaf>` when the binding isn't evaluated.
 */
function enumCurrentLeaf(
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
 * Pull the current value for a scalar parameter. Preference order:
 *   1. `value.value`  — evaluated literal OMC computed for us
 *   2. `value.binding` — only if it's already a primitive (numbers,
 *      booleans, plain strings) — tagged expressions like `binary_op`
 *      get reduced to `undefined` so the form falls back to its default.
 *   3. `modifiers`     — the raw user-written expression text. Quoted
 *      string literals (`"\"foo\""`) are unwrapped for the `string` kind.
 */
function currentPrimitiveValue(
  el: ComponentElement,
  kind: PrimitiveKind,
): unknown {
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

export function classParameterValueToExpr(
  ref: ClassParameterRef,
  value: unknown,
): string {
  return valueToExpr(ref.kind, value, ref.enumTypeName);
}
