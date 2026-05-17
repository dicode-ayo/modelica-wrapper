/**
 * Shared Modelica-type-shape helpers used by the class-level and
 * component-level parameter-form builders. Pure of vscode / dom imports.
 *
 * "Shape" here means: given a `ComponentElement.type` (which can be a
 * primitive name like `"Real"`, a nested `ModelInstance` aliased through
 * `extends`, or an enumeration type), resolve it to the small vocabulary
 * the parameter modal renders (scalar number/integer/boolean/string +
 * enum picker) and surface the metadata both builders need.
 */

import type {
  ComponentElement,
  ExtendsElement,
  ModelInstance,
} from "@modelica-wrapper/omc-client";

export type PrimitiveKind = "number" | "integer" | "boolean" | "string";

/**
 * Walk a (possibly aliased) Modelica type to one of the four primitive
 * roots — typical aliasing pattern is `type Angle = Real(unit="rad")`,
 * so we follow the first `extends` of each non-primitive type.
 *
 * Depth-limited (8) to guard against any pathological cycles in
 * malformed inputs.
 */
export function resolvePrimitive(
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

export function primitiveOf(name: string | undefined): PrimitiveKind | undefined {
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
 * Detect an enumeration type and return its leaf names in declaration
 * order. Enum types extend the special `enumeration` baseClass and list
 * their literals as bare `component` elements with no variability prefix.
 */
export function enumLeavesIfEnum(
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

export function typeQualifiedName(
  type: ComponentElement["type"],
): string | undefined {
  if (!type || typeof type === "string") return undefined;
  return type.name;
}

export function stripPrefix(name: string, qualified: string): string {
  const prefix = `${qualified}.`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/**
 * OMC emits string-typed modifier bindings with embedded quotes
 * (`"\"rad\""`) — strip one layer so the user edits the inner text.
 */
export function unquoteString(s: string): string {
  if (s.length >= 2 && s.startsWith(`"`) && s.endsWith(`"`)) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Coerce a raw value (from `value.value`, `value.binding`, or a modifier
 * string) into the JSON-Schema kind the form expects. Returns `undefined`
 * for un-coercible inputs so the caller can fall back to a placeholder.
 */
export function coerceToKind(raw: unknown, kind: PrimitiveKind): unknown {
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
 * Translate a single submitted form value into the Modelica expression
 * `setElementModifierValue` expects. Mirrors `coerceToKind` in reverse:
 *  - numbers / booleans → their literal form (`12`, `true`)
 *  - strings (for string-typed params) → wrapped in `"..."`
 *  - enums → `<qualified>.<leaf>`
 *  - `undefined` / `""` → empty string (caller treats as "clear")
 */
export function valueToExpr(
  kind: PrimitiveKind | "enum",
  value: unknown,
  enumTypeName?: string,
): string {
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
  }
}
