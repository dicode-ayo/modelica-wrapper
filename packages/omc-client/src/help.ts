/**
 * Structured introspection + human-readable rendering for every function
 * in `REGISTRY`.
 *
 * Two layers:
 *
 *   1. `describeFunction(name)` returns a structured `FunctionDescription`:
 *      name, category, free-form description, and field lists for both the
 *      input and output schemas. Each field carries its type label,
 *      optional / default flags, and description.
 *
 *   2. `renderFunctionHelp(name)` / `renderCategoryHelp(cat)` /
 *      `renderOverview()` return plain-text help blocks built on top of
 *      layer 1. Used by the VSCode extension's REPL today; equally usable
 *      from a CLI or `--help` flag in a future tool.
 *
 * Implementation: each schema is converted to JSON Schema (draft 2020-12)
 * via `z.toJSONSchema`, then walked as a plain JS object. JSON Schema is
 * a well-specified, stable wire format — much easier to traverse than
 * zod's internal class hierarchy and immune to zod major-version shifts.
 *
 * Inputs use `io: "input"` so `required` reflects "must be supplied by
 * the caller" (anything `.optional()` or `.default(...)` is omittable).
 * Outputs use the default (`io: "output"`) so `required` reflects the
 * post-parse shape (defaulted fields are guaranteed present), which is
 * what callers want to see when reading the return-type help.
 *
 * The JSON Schema itself is exposed via `describeFunctionAsJsonSchema(name)`
 * so consumers (MCP tool generators, docs site, codegen) can consume it
 * directly without re-deriving from the zod schemas.
 */

import { z } from "zod";

import {
  REGISTRY,
  functionsByCategory,
  omcFunctionNames,
  type OmcFnName,
} from "./registry.js";

/** A single field in an input or output object schema. */
export interface FieldInfo {
  name: string;
  /** Human-readable type label (e.g. `string`, `boolean[]`, `("a" | "b")`). */
  typeLabel: string;
  /** True when the field is omittable by the caller (`.optional()` or `.default(...)`). */
  optional: boolean;
  /** Resolved default value if the field has one — JS value, not stringified. */
  defaultValue: unknown;
  /** Description set via `.describe(...)`, when present. */
  description: string | undefined;
}

/** Everything we know about a single OMC function. */
export interface FunctionDescription {
  name: OmcFnName;
  category: string;
  description: string;
  parameters: FieldInfo[];
  returns: FieldInfo[];
}

/** A single function's JSON Schema slice + metadata. */
export interface FunctionJsonSchema {
  name: OmcFnName;
  category: string;
  description: string;
  /** JSON Schema (draft 2020-12) of the input — `io: "input"` semantics. */
  input: z.core.JSONSchema.BaseSchema;
  /** JSON Schema (draft 2020-12) of the output — `io: "output"` semantics. */
  output: z.core.JSONSchema.BaseSchema;
}

/**
 * Structured introspection: returns the function's metadata plus the
 * field-by-field shape of its input and output schemas. The lists are
 * empty when the relevant schema isn't an object (e.g. a function
 * returning a bare boolean via `SuccessOutput`).
 */
export function describeFunction(name: OmcFnName): FunctionDescription {
  const entry = REGISTRY[name];
  return {
    name,
    category: entry.category,
    description: entry.description,
    parameters: describeFieldsFromSchema(entry.inputSchema, "input"),
    returns: describeFieldsFromSchema(entry.outputSchema, "output"),
  };
}

/**
 * Same metadata as `describeFunction`, but returns the raw JSON Schema
 * objects so consumers (MCP tool definitions, docs, codegen) can hand
 * them off to standard JSON Schema tooling.
 */
export function describeFunctionAsJsonSchema(
  name: OmcFnName,
): FunctionJsonSchema {
  const entry = REGISTRY[name];
  return {
    name,
    category: entry.category,
    description: entry.description,
    input: z.toJSONSchema(entry.inputSchema, { io: "input" }),
    output: z.toJSONSchema(entry.outputSchema),
  };
}

/**
 * Plain-text help block for a single function. See file-level docstring
 * for the rendered layout.
 */
export function renderFunctionHelp(name: OmcFnName): string {
  const desc = describeFunction(name);
  const lines: string[] = [];
  lines.push(`${desc.name} — ${desc.category}`);
  lines.push(indent(desc.description, "  "));
  lines.push("");

  lines.push("Parameters:");
  if (desc.parameters.length === 0) {
    lines.push("  (none)");
  } else {
    for (const f of desc.parameters) {
      lines.push(`  ${formatFieldSignature(f)}`);
      if (f.description) lines.push(indent(f.description, "    "));
    }
  }
  lines.push("");

  lines.push("Returns:");
  if (desc.returns.length === 0) {
    lines.push("  (raw value)");
  } else {
    for (const f of desc.returns) {
      lines.push(`  ${f.name}: ${f.typeLabel}`);
      if (f.description) lines.push(indent(f.description, "    "));
    }
  }
  return lines.join("\n");
}

/**
 * Plain-text help block for an entire category: one line per function with
 * a truncated description. Returns `undefined` if the category isn't known
 * — caller decides how to surface that (error vs fallback).
 */
export function renderCategoryHelp(category: string): string | undefined {
  const byCat = functionsByCategory();
  if (!Object.prototype.hasOwnProperty.call(byCat, category)) return undefined;
  const names = byCat[category] ?? [];
  const lines: string[] = [];
  lines.push(`${category} — ${names.length} functions:`);
  const namePad = Math.min(36, Math.max(...names.map((n) => n.length)) + 2);
  for (const name of [...names].sort()) {
    const entry = REGISTRY[name];
    lines.push(`  ${name.padEnd(namePad)}${oneLine(entry.description)}`);
  }
  return lines.join("\n");
}

/**
 * Plain-text summary of every category with a function count plus an
 * overall total. No leading section heading — the caller is free to wrap
 * this in their own header.
 */
export function renderOverview(): string {
  const byCat = functionsByCategory();
  const cats = Object.keys(byCat).sort();
  const lines: string[] = [];
  lines.push(
    `OMC API (${omcFunctionNames.length} functions; try \`<category>\` or \`<name>\`):`,
  );
  const labelPad = 16;
  for (const cat of cats) {
    const count = byCat[cat]!.length;
    lines.push(`  ${cat.padEnd(labelPad)}${count}`);
  }
  return lines.join("\n");
}

// ── JSON Schema introspection ────────────────────────────────────────────

/**
 * Alias for zod's JSON Schema node type. `_JSONSchema = boolean | JSONSchema`
 * accommodates JSON Schema 2020-12's `true` / `false` shorthand for
 * "always valid" / "always invalid" — we narrow it away with `asNode`
 * before reading fields.
 */
type Node = z.core.JSONSchema.BaseSchema;

/** Skip boolean-form schemas (`true` / `false`); return the object form or undefined. */
function asNode(s: unknown): Node | undefined {
  return s && typeof s === "object" ? (s as Node) : undefined;
}

function describeFieldsFromSchema(
  schema: z.ZodType,
  io: "input" | "output",
): FieldInfo[] {
  const node = z.toJSONSchema(schema, { io });
  if (node.type !== "object" || !node.properties) return [];
  const requiredSet = new Set(node.required ?? []);
  const out: FieldInfo[] = [];
  for (const [name, raw] of Object.entries(node.properties)) {
    const field = asNode(raw);
    if (!field) continue; // boolean-form property — skip
    const hasDefault = Object.prototype.hasOwnProperty.call(field, "default");
    const optional = !requiredSet.has(name) || hasDefault;
    out.push({
      name,
      typeLabel: typeLabel(field),
      optional,
      defaultValue: hasDefault ? field.default : undefined,
      description: field.description,
    });
  }
  return out;
}

function typeLabel(node: Node): string {
  // `const` and `enum` are more specific than `type`; render them first
  // so a `z.literal("Foo")` (rendered by zod as `{type: "string", const: "Foo"}`)
  // surfaces as `"Foo"` rather than just `string`.
  if (node.const !== undefined) return JSON.stringify(node.const);
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return `(${node.enum.map((v) => JSON.stringify(v)).join(" | ")})`;
  }
  if (node.type === "array") {
    // `items` may be a single schema, a tuple-array of schemas, or a
    // boolean. OMC schemas only use the single-schema form; the others
    // fall through to "array" rather than mis-labeling.
    const items = !Array.isArray(node.items) ? asNode(node.items) : undefined;
    return items ? `${typeLabel(items)}[]` : "array";
  }
  if (node.type === "string") return "string";
  if (node.type === "number" || node.type === "integer") return "number";
  if (node.type === "boolean") return "boolean";
  if (node.type === "object") return "object";
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) return "union";
  // Anything else (`null`, multi-type arrays, …) — return zod's own tag.
  return typeof node.type === "string" && node.type.length > 0
    ? node.type
    : "unknown";
}

function formatFieldSignature(f: FieldInfo): string {
  let s = `${f.name}: ${f.typeLabel}`;
  if (f.optional || f.defaultValue !== undefined) {
    const inside =
      f.defaultValue !== undefined
        ? `optional, default ${stringifyValue(f.defaultValue)}`
        : "optional";
    s += ` (${inside})`;
  }
  return s;
}

function stringifyValue(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v))
    return `[${v.map((x) => stringifyValue(x)).join(", ")}]`;
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ── Text helpers ─────────────────────────────────────────────────────────

function oneLine(s: string): string {
  // Collapse internal newlines + extra whitespace. Truncate so the
  // category listing stays scannable on terminals that don't wrap.
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > 110 ? `${flat.slice(0, 107)}...` : flat;
}

function indent(s: string, prefix: string): string {
  return s
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
