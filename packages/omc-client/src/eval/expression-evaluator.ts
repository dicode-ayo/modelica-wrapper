/**
 * Minimal evaluator for the `Expression` AST that `getModelInstance`
 * leaves in places where OMC deliberately does NOT pre-evaluate:
 *   - `annotation.Dialog.enable` on parameters (live UI gating),
 *   - conditional component declarations (`Real x if use_x;`),
 *   - array-dimension expressions (`Pin[n] pins`),
 *   - any future expression OMC ships as an AST and expects clients
 *     to evaluate against a parameter context.
 *
 * The evaluator is intentionally narrow: it walks the AST shapes
 * `_shared/modelInstance.ts` declares (`binary_op` / `unary_op` / `if`
 * / `call` / `cref` / `enum` / `record` / primitives / arrays) and
 * supports the operators those expressions actually use in practice.
 * Unknown ops, unresolved crefs, or shape mismatches return
 * `undefined` so the result composes cleanly — the outer caller
 * decides what to do when the answer is "I don't know" (e.g. the
 * parameter form treats `undefined` for Dialog.enable as "enabled",
 * preserving today's behaviour on parse failure).
 *
 * Pure of vscode / DOM imports — the consumers are diagram-ui's
 * parameter form (browser) and potentially the extension host (Node).
 */

import type {
  BinaryOpExpr,
  CallExpr,
  ComponentRef,
  EnumLiteral,
  Expression,
  IfExpr,
  RecordValue,
  UnaryOpExpr,
} from "../_shared/modelInstance.js";

/**
 * Values the evaluator produces and accepts as scope lookups. Enum
 * literals stay tagged (so equality can compare qualified names rather
 * than coercing to strings); records pass through as their wire shape.
 */
export type EvalValue =
  | number
  | boolean
  | string
  | null
  | undefined
  | EnumLiteralValue
  | EvalValue[]
  | RecordValue;

export interface EnumLiteralValue {
  $kind: "enum";
  /** Qualified type-relative name (e.g. `Modelica.Blocks.Types.SimpleController.PI`). */
  name: string;
  /** OMC's 1-based ordinal, when known. Optional because some callers
   *  synthesize enum literals from a form-side leaf name + known type. */
  index?: number;
}

/**
 * The evaluator's lookup interface. Implementations resolve a
 * component-reference's name parts (e.g. `["PI", "controllerType"]`)
 * to a value. Returning `undefined` is the "unresolved" signal and
 * propagates through enclosing operators.
 *
 * `callFunction` is optional — Modelica's standard built-ins
 * (`abs`, `sqrt`, `noEvent`, …) aren't surfaced here yet; callers
 * that need them can supply an implementation.
 */
export interface EvalScope {
  lookup(parts: ReadonlyArray<string>): EvalValue;
  callFunction?(name: string, args: EvalValue[]): EvalValue;
}

export interface EvaluateOptions {
  /**
   * Value to substitute when the evaluator can't produce a concrete
   * answer (unknown op, unresolved cref, type mismatch on a binary
   * op). Defaults to `undefined`. The Dialog-enable consumer passes
   * `true` so a parse failure keeps the field visible — the user's
   * Dialog gating logic is a UI hint, not load-bearing semantics.
   */
  fallback?: EvalValue;
}

/**
 * Walk `expr` against `scope` and return a concrete value, or the
 * configured `fallback` (default `undefined`) when the expression
 * cannot be reduced. The evaluator NEVER throws — it always returns
 * a value or the fallback.
 */
export function evaluateExpression(
  expr: Expression,
  scope: EvalScope,
  opts: EvaluateOptions = {},
): EvalValue {
  const result = evalInner(expr, scope);
  return result === undefined ? opts.fallback : result;
}

// ── Internal walker ──────────────────────────────────────────────────

function evalInner(expr: Expression, scope: EvalScope): EvalValue {
  if (expr === null) return null;
  if (
    typeof expr === "number" ||
    typeof expr === "boolean" ||
    typeof expr === "string"
  ) {
    return expr;
  }
  if (Array.isArray(expr)) {
    const out: EvalValue[] = [];
    for (const e of expr) {
      const v = evalInner(e, scope);
      if (v === undefined) return undefined;
      out.push(v);
    }
    return out;
  }
  if (typeof expr !== "object") return undefined;
  const kind = (expr as { $kind?: unknown }).$kind;
  switch (kind) {
    case "cref":
      return evalCref(expr as ComponentRef, scope);
    case "enum":
      return evalEnum(expr as EnumLiteral);
    case "binary_op":
      return evalBinaryOp(expr as BinaryOpExpr, scope);
    case "unary_op":
      return evalUnaryOp(expr as UnaryOpExpr, scope);
    case "if":
      return evalIf(expr as IfExpr, scope);
    case "call":
      return evalCall(expr as CallExpr, scope);
    case "record":
      // Records pass through — equality between records isn't part of
      // the supported vocabulary yet. Consumers that need to read a
      // record field can recurse into `.elements` themselves.
      return expr as RecordValue;
    default:
      return undefined;
  }
}

function evalCref(expr: ComponentRef, scope: EvalScope): EvalValue {
  // Subscripts (`a[i]`) aren't part of the supported vocabulary —
  // they appear in Dialog.enable only for advanced cases. Refuse and
  // let the caller fall back.
  for (const p of expr.parts) {
    if (p.subscripts && p.subscripts.length > 0) return undefined;
  }
  return scope.lookup(expr.parts.map((p) => p.name));
}

function evalEnum(expr: EnumLiteral): EnumLiteralValue {
  // Optional index — kept as-is when present.
  const out: EnumLiteralValue = { $kind: "enum", name: expr.name };
  if (typeof expr.index === "number") out.index = expr.index;
  return out;
}

function evalBinaryOp(expr: BinaryOpExpr, scope: EvalScope): EvalValue {
  // Short-circuit for boolean ops so an unresolved RHS doesn't poison
  // a result the LHS already determined.
  if (expr.op === "and" || expr.op === "or") {
    const lhs = evalInner(expr.lhs, scope);
    if (typeof lhs !== "boolean") return undefined;
    if (expr.op === "and" && lhs === false) return false;
    if (expr.op === "or" && lhs === true) return true;
    const rhs = evalInner(expr.rhs, scope);
    if (typeof rhs !== "boolean") return undefined;
    return rhs;
  }
  const lhs = evalInner(expr.lhs, scope);
  if (lhs === undefined) return undefined;
  const rhs = evalInner(expr.rhs, scope);
  if (rhs === undefined) return undefined;
  switch (expr.op) {
    case "==":
      return equals(lhs, rhs);
    case "<>":
    case "!=":
      return !equals(lhs, rhs);
    case "<":
      return numericPair(lhs, rhs, (a, b) => a < b);
    case "<=":
      return numericPair(lhs, rhs, (a, b) => a <= b);
    case ">":
      return numericPair(lhs, rhs, (a, b) => a > b);
    case ">=":
      return numericPair(lhs, rhs, (a, b) => a >= b);
    case "+":
      if (typeof lhs === "string" && typeof rhs === "string") return lhs + rhs;
      return numericPair(lhs, rhs, (a, b) => a + b);
    case "-":
      return numericPair(lhs, rhs, (a, b) => a - b);
    case "*":
      return numericPair(lhs, rhs, (a, b) => a * b);
    case "/":
      return numericPair(lhs, rhs, (a, b) => a / b);
    case "^":
      return numericPair(lhs, rhs, (a, b) => Math.pow(a, b));
    default:
      return undefined;
  }
}

function evalUnaryOp(expr: UnaryOpExpr, scope: EvalScope): EvalValue {
  const v = evalInner(expr.exp, scope);
  if (v === undefined) return undefined;
  switch (expr.op) {
    case "-":
      return typeof v === "number" ? -v : undefined;
    case "+":
      return typeof v === "number" ? v : undefined;
    case "not":
      return typeof v === "boolean" ? !v : undefined;
    default:
      return undefined;
  }
}

function evalIf(expr: IfExpr, scope: EvalScope): EvalValue {
  const cond = evalInner(expr.condition, scope);
  if (typeof cond !== "boolean") return undefined;
  return evalInner(cond ? expr.true : expr.false, scope);
}

function evalCall(expr: CallExpr, scope: EvalScope): EvalValue {
  const args: EvalValue[] = [];
  for (const a of expr.arguments) {
    const v = evalInner(a, scope);
    if (v === undefined) return undefined;
    args.push(v);
  }
  // `noEvent` / `pre` / `smooth` / `actualStream` are semantics
  // wrappers OMC emits inside expressions; they're identity for our
  // purposes. The user can supply more in `scope.callFunction`.
  if (
    (expr.name === "noEvent" ||
      expr.name === "pre" ||
      expr.name === "smooth" ||
      expr.name === "actualStream") &&
    args.length >= 1
  ) {
    return args[args.length - 1] ?? undefined;
  }
  if (scope.callFunction) {
    return scope.callFunction(expr.name, args);
  }
  return undefined;
}

// ── Helpers ──────────────────────────────────────────────────────────

function equals(a: EvalValue, b: EvalValue): boolean {
  if (a === b) return true;
  // Enum literal equality — compare qualified names. We accept a
  // string on either side as the form may pass the qualified-name
  // form before tagging; the scope wrapper is expected to tag enum
  // values before they reach here, but this is a graceful belt.
  if (
    typeof a === "object" &&
    a !== null &&
    !Array.isArray(a) &&
    (a as { $kind?: unknown }).$kind === "enum"
  ) {
    return enumName(a) === enumName(b);
  }
  if (
    typeof b === "object" &&
    b !== null &&
    !Array.isArray(b) &&
    (b as { $kind?: unknown }).$kind === "enum"
  ) {
    return enumName(a) === enumName(b);
  }
  return false;
}

function enumName(v: EvalValue): string | undefined {
  if (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    (v as { $kind?: unknown }).$kind === "enum"
  ) {
    return (v as { name?: unknown }).name as string | undefined;
  }
  if (typeof v === "string") return v;
  return undefined;
}

function numericPair(
  a: EvalValue,
  b: EvalValue,
  op: (x: number, y: number) => number | boolean,
): EvalValue {
  if (typeof a !== "number" || typeof b !== "number") return undefined;
  return op(a, b);
}
