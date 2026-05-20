/**
 * Pure JSON Schema → flat field list normaliser for the parameter form.
 *
 * Top-level fields only — nested objects are deferred. The vocabulary
 * matches what OMC's simulation-options + Modelica parameter schemas
 * actually produce: scalars (`string` / `number` / `boolean`), enums on
 * strings, and arrays of scalars. Anything outside that vocabulary is
 * still listed (so the UI doesn't silently lose fields) but rendered as
 * a read-only fallback widget by the consumer.
 *
 * Pure of Lit / DOM imports so it's testable with plain vitest.
 */

import type { Expression, JsonSchema } from "@modelica-wrapper/omc-client";
// Sub-path import: the evaluator subtree only — the bare-name import
// above is type-only (erased at build) so neither path drags the OMC
// transport (zeromq / cmake-ts) into the webview bundle.
import {
  evaluateExpression,
  prefixStrippingScope,
  recordScope,
  type EvalScope,
  type EvalValue,
} from "@modelica-wrapper/omc-client/eval";

/** Subset of JSON Schema 2020-12 we walk — alias for omc-client's re-export. */
type Node = JsonSchema;

export type FieldKind =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "array"
  | "unsupported";

export interface ParameterField {
  /** Property name as keyed in the parent schema. */
  name: string;
  /** Widget kind we want to render for this field. */
  kind: FieldKind;
  /** True if the field is required (not in schema.required, no default). */
  required: boolean;
  /** Resolved default value, if any. */
  defaultValue: unknown;
  /** Human description from `.describe(...)`. */
  description: string | undefined;
  /** Enum options when `kind === "enum"`. */
  enumValues: ReadonlyArray<unknown>;
  /** Element kind for `kind === "array"`. Falls back to "string" if untyped. */
  itemKind: FieldKind | undefined;
  /**
   * Modelica Dialog tab / group, surfaced from the schema's
   * `x-modelica-tab` / `x-modelica-group` extension keys. `undefined`
   * when the schema doesn't set them (e.g. the curated simulate form,
   * which renders flat).
   */
  tab: string | undefined;
  group: string | undefined;
  /**
   * Raw `Dialog.enable` expression AST (from `x-modelica-enable`).
   * Evaluated by the form against live working values so the control
   * goes `disabled` when the condition is false. `undefined` means
   * "always enabled".
   */
  enable: Expression | undefined;
  /**
   * Qualified type name for enum fields (from `x-modelica-enum-type`).
   * The form needs it to qualify a leaf-name working value (`"PI"`)
   * before equality-checking it against a fully-qualified enum literal
   * from a Dialog.enable expression.
   */
  enumTypeName: string | undefined;
  /** The raw JSON Schema node — kept on the field so the renderer can read extras (min/max/pattern). */
  raw: Node;
}

/**
 * Walk the top-level `properties` of a JSON Schema object and produce one
 * `ParameterField` entry per property. Property iteration order matches
 * the schema's own — `Object.entries` preserves insertion order for
 * non-numeric keys, and zod's `toJSONSchema` emits them in the order the
 * caller declared with `z.object({...})`.
 */
export function parameterFieldsFromSchema(schema: Node): ParameterField[] {
  if (schema.type !== "object" || !schema.properties) return [];
  const requiredSet = new Set(schema.required ?? []);
  const out: ParameterField[] = [];
  for (const [name, raw] of Object.entries(schema.properties)) {
    const field = coerceNode(raw);
    if (!field) continue;
    const hasDefault = Object.prototype.hasOwnProperty.call(field, "default");
    out.push({
      name,
      kind: detectKind(field),
      required: requiredSet.has(name) && !hasDefault,
      defaultValue: hasDefault ? field.default : undefined,
      description: field.description,
      enumValues: Array.isArray(field.enum) ? field.enum : [],
      itemKind: detectArrayItemKind(field),
      tab: readString(field, "x-modelica-tab"),
      group: readString(field, "x-modelica-group"),
      enable: readExpression(field, "x-modelica-enable"),
      enumTypeName: readString(field, "x-modelica-enum-type"),
      raw: field,
    });
  }
  return out;
}

function readString(node: Node, key: string): string | undefined {
  const v = (node as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

function readExpression(node: Node, key: string): Expression | undefined {
  // The schema-side encoding is "plain JSON the evaluator can walk" —
  // the evaluator handles every shape, including malformed ones, by
  // returning `undefined`. We don't validate here; trust the builder.
  const v = (node as Record<string, unknown>)[key];
  return v === undefined ? undefined : (v as Expression);
}

/** True when every required field has a usable value in `values`. */
export function isComplete(
  fields: ReadonlyArray<ParameterField>,
  values: Record<string, unknown>,
): boolean {
  for (const f of fields) {
    if (!f.required) continue;
    const v = values[f.name];
    if (v === undefined || v === null || v === "") return false;
  }
  return true;
}

/**
 * Build the initial `values` record by walking each field and picking
 * either the user-supplied initial value (if `initial[name]` is defined)
 * or the schema's default. Fields without either get `undefined`, so
 * `Object.keys(initialValues)` still includes them — the renderer can
 * decide whether to show a placeholder.
 */
export function initialValuesFromFields(
  fields: ReadonlyArray<ParameterField>,
  initial: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(initial, f.name)) {
      out[f.name] = initial[f.name];
    } else if (f.defaultValue !== undefined) {
      out[f.name] = f.defaultValue;
    } else {
      out[f.name] = undefined;
    }
  }
  return out;
}

function coerceNode(raw: unknown): Node | undefined {
  // JSON Schema 2020-12 allows `boolean` shorthand for properties
  // (`true` = any value, `false` = never valid). We don't try to render
  // those — they don't appear in OMC schemas.
  return raw && typeof raw === "object" ? (raw as Node) : undefined;
}

function detectKind(node: Node): FieldKind {
  // enum trumps type — `{type: "string", enum: ["a","b"]}` is a picker.
  if (Array.isArray(node.enum) && node.enum.length > 0) return "enum";
  switch (node.type) {
    case "string":
      return "string";
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    default:
      return "unsupported";
  }
}

function detectArrayItemKind(node: Node): FieldKind | undefined {
  if (node.type !== "array") return undefined;
  // JSON Schema 2020-12: `items` may be a single schema, a tuple-array,
  // or a boolean. We only handle the single-schema form (matches what
  // zod's toJSONSchema emits for `z.array(z.string())`).
  const items = node.items;
  if (!items || Array.isArray(items) || typeof items === "boolean") {
    return "string";
  }
  return detectKind(items as Node);
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
