/**
 * Resolve a producer-emitted `Expression` (the union upstream is permissive
 * — see `_shared/modelInstance.ts`) into a flat display string for use as
 * the body of an SVG `<text>` element.
 *
 * Rules implemented:
 *  - `string`                       → as-is
 *  - `number | boolean`             → `String(value)`
 *  - `null | undefined`             → `""`
 *  - `DynamicSelect(staticDefault, dynamicExpr)` (a `call` with
 *    `name === "DynamicSelect"`) → recurse on the static default
 *  - `cref` (`{ $kind: "cref", parts }`) → `parts.map(p => p.name).join(".")`
 *    Placeholder display; the renderer can later substitute live values.
 *  - Anything else                  → `""` (and never throws).
 *
 * The Expression union is intentionally lax — OMC emits new $kind variants
 * occasionally and the producer passes them through verbatim. Returning
 * `""` instead of crashing keeps the renderer robust against drift.
 */

import type { CallExpr, ComponentRef, Expression } from "./types.js";

export function expressionToString(expr: Expression | undefined): string {
  if (expr === null || expr === undefined) return "";
  if (typeof expr === "string") return expr;
  if (typeof expr === "number" || typeof expr === "boolean")
    return String(expr);

  if (Array.isArray(expr)) return "";

  // Tagged $kind variants
  if (typeof expr === "object" && expr !== null && "$kind" in expr) {
    const kind = (expr as { $kind: unknown }).$kind;
    if (kind === "call") {
      const call = expr as CallExpr;
      if (call.name === "DynamicSelect") {
        const staticDefault = call.arguments?.[0];
        return expressionToString(staticDefault);
      }
      // Unknown call — defensive fallback.
      return "";
    }
    if (kind === "cref") {
      const ref = expr as ComponentRef;
      const parts = ref.parts;
      if (!Array.isArray(parts)) return "";
      return parts
        .map((p) => (p && typeof p.name === "string" ? p.name : ""))
        .filter((s) => s.length > 0)
        .join(".");
    }
    // Other $kinds (binary_op, unary_op, if, enum, record, ...) — TODO,
    // emit "" for now.
    return "";
  }

  // Plain object without $kind: not a renderable expression.
  return "";
}
