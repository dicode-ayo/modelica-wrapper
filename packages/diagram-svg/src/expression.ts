/**
 * Resolve a producer-emitted `Expression` (the union upstream is permissive
 * — see `_shared/modelInstance.ts`) into a flat display string for use as
 * the body of an SVG `<text>` element or a read-only value cell.
 *
 * Rules implemented:
 *  - `string`                       → as-is
 *  - `number | boolean`             → `String(value)`
 *  - `null | undefined`             → `""`
 *  - `DynamicSelect(staticDefault, dynamicExpr)` (a `call` with
 *    `name === "DynamicSelect"`) → recurse on the static default
 *  - `cref` (`{ $kind: "cref", parts }`) → `parts.map(p => p.name).join(".")`
 *    Placeholder display; the renderer can later substitute live values.
 *  - `enum`                         → its qualified `name`
 *  - `binary_op` / `unary_op`       → infix / prefix notation, parenthesized
 *    where MLS §3.2 operator precedence requires it
 *  - Anything else                  → `""` (and never throws).
 *
 * The Expression union is intentionally lax — OMC emits new $kind variants
 * occasionally and the producer passes them through verbatim. Returning
 * `""` instead of crashing keeps the renderer robust against drift.
 */

import type {
  BinaryOpExpr,
  CallExpr,
  ComponentRef,
  EnumLiteral,
  Expression,
  UnaryOpExpr,
} from "./types.js";

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
    if (kind === "enum") {
      const lit = expr as EnumLiteral;
      return typeof lit.name === "string" ? lit.name : "";
    }
    if (kind === "binary_op") {
      const bin = expr as BinaryOpExpr;
      if (typeof bin.op !== "string") return "";
      const prec = binaryPrecedence(bin.op);
      const lhs = operandToString(bin.lhs, prec, false);
      const rhs = operandToString(bin.rhs, prec, true);
      if (lhs.length === 0 || rhs.length === 0) return "";
      return `${lhs} ${bin.op} ${rhs}`;
    }
    if (kind === "unary_op") {
      const un = expr as UnaryOpExpr;
      if (typeof un.op !== "string") return "";
      const operand = operandToString(un.exp, unaryPrecedence(un.op), true);
      if (operand.length === 0) return "";
      // Word operators (`not`) need the separating space; sign (`-`) hugs.
      const sep = /[a-z]$/i.test(un.op) ? " " : "";
      return `${un.op}${sep}${operand}`;
    }
    // Other $kinds (if, record, ...) — TODO, emit "" for now.
    return "";
  }

  // Plain object without $kind: not a renderable expression.
  return "";
}

/**
 * MLS §3.2 operator precedence, higher binds tighter. Unary `-`/`+` sit
 * between the additive and multiplicative tiers (`-a * b` parses as
 * `-(a * b)`; `2 * (-3)` needs its parentheses). Unknown operators get 0
 * so a compound neighbour parenthesizes rather than mis-groups.
 */
function binaryPrecedence(op: string): number {
  switch (op) {
    case "^":
    case ".^":
      return 6;
    case "*":
    case "/":
    case ".*":
    case "./":
      return 5;
    case "+":
    case "-":
    case ".+":
    case ".-":
      return 4;
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "==":
    case "<>":
      return 3;
    case "and":
      return 2;
    case "or":
      return 1;
    default:
      return 0;
  }
}

function unaryPrecedence(op: string): number {
  return op === "not" ? 2.5 : 4.5;
}

const POW_PRECEDENCE = binaryPrecedence("^");

/**
 * Render one operand, parenthesizing when its own operator binds looser
 * than the parent (`2 * (a + b)`), or equally tight on the right of a
 * non-associative chain (`a - (b - c)`). `^` wraps an equal-precedence
 * operand on either side — `factor : primary [("^" | ".^") primary]`
 * admits a single exponent, so `a ^ 2 ^ 3` is not writable Modelica.
 * A unary operand on the right is always wrapped. Inside the arithmetic
 * tiers that is required (a sign is only writable at the start of an
 * arithmetic expression, so `a - -b` is not valid Modelica); elsewhere
 * (`a and (not b)`, `a < (-b)`) it is deliberately conservative —
 * redundant parentheses, never wrong ones.
 */
function operandToString(
  operand: Expression,
  parentPrec: number,
  isRhs: boolean,
): string {
  const rendered = expressionToString(operand);
  if (rendered.length === 0) return "";
  const info = operatorInfo(operand);
  if (info === undefined) return rendered;
  if (
    info.prec < parentPrec ||
    (info.prec === parentPrec && parentPrec === POW_PRECEDENCE) ||
    (isRhs && (info.prec <= parentPrec || info.unary))
  ) {
    return `(${rendered})`;
  }
  return rendered;
}

function operatorInfo(
  operand: Expression,
): { prec: number; unary: boolean } | undefined {
  if (
    typeof operand !== "object" ||
    operand === null ||
    Array.isArray(operand) ||
    !("$kind" in operand)
  ) {
    return undefined;
  }
  const kind = (operand as { $kind: unknown }).$kind;
  if (kind === "binary_op") {
    const op = (operand as BinaryOpExpr).op;
    if (typeof op !== "string") return undefined;
    return { prec: binaryPrecedence(op), unary: false };
  }
  if (kind === "unary_op") {
    const op = (operand as UnaryOpExpr).op;
    if (typeof op !== "string") return undefined;
    return { prec: unaryPrecedence(op), unary: true };
  }
  return undefined;
}
