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

import type { JsonSchema } from "@modelica-wrapper/omc-client";

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
      raw: field,
    });
  }
  return out;
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
