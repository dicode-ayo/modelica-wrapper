import { describe, expect, it } from "vitest";

import type { Expression } from "../_shared/modelInstance.js";

import {
  evaluateExpression,
  type EvalScope,
  type EvalValue,
} from "./expression-evaluator.js";
import { prefixStrippingScope, recordScope } from "./scope.js";

const emptyScope: EvalScope = { lookup: () => undefined };

function values(rec: Record<string, EvalValue>): EvalScope {
  return recordScope(rec);
}

describe("evaluateExpression — primitives", () => {
  it("returns numbers / booleans / strings / null verbatim", () => {
    expect(evaluateExpression(1.5, emptyScope)).toBe(1.5);
    expect(evaluateExpression(true, emptyScope)).toBe(true);
    expect(evaluateExpression("x", emptyScope)).toBe("x");
    expect(evaluateExpression(null, emptyScope)).toBe(null);
  });

  it("returns the configured fallback on unknown shapes", () => {
    expect(
      evaluateExpression({ $kind: "totally-fake" } as unknown as Expression, emptyScope, {
        fallback: true,
      }),
    ).toBe(true);
  });
});

describe("binary_op", () => {
  it("compares numbers", () => {
    const e: Expression = {
      $kind: "binary_op",
      op: "<",
      lhs: 1,
      rhs: 2,
    };
    expect(evaluateExpression(e, emptyScope)).toBe(true);
  });

  it("compares two enum literals by qualified name", () => {
    const e: Expression = {
      $kind: "binary_op",
      op: "==",
      lhs: { $kind: "enum", name: "T.PI", index: 2 },
      rhs: { $kind: "enum", name: "T.PI", index: 2 },
    };
    expect(evaluateExpression(e, emptyScope)).toBe(true);
  });

  it("compares an enum literal against a string (form-side leaf)", () => {
    // Either order; both sides must qualify to the same name. A scope
    // wrapper around the form is expected to tag values before
    // evaluation, but the evaluator's belt accepts a bare string too.
    const e: Expression = {
      $kind: "binary_op",
      op: "==",
      lhs: { $kind: "enum", name: "T.PI", index: 2 },
      rhs: "T.PI",
    };
    expect(evaluateExpression(e, emptyScope)).toBe(true);
  });

  it("short-circuits `and` so an unresolved RHS doesn't poison a false LHS", () => {
    const e: Expression = {
      $kind: "binary_op",
      op: "and",
      lhs: false,
      rhs: { $kind: "cref", parts: [{ name: "missing" }] },
    };
    expect(evaluateExpression(e, emptyScope)).toBe(false);
  });

  it("short-circuits `or` so an unresolved RHS doesn't poison a true LHS", () => {
    const e: Expression = {
      $kind: "binary_op",
      op: "or",
      lhs: true,
      rhs: { $kind: "cref", parts: [{ name: "missing" }] },
    };
    expect(evaluateExpression(e, emptyScope)).toBe(true);
  });

  it("does arithmetic on numbers and concatenation on strings", () => {
    expect(
      evaluateExpression(
        { $kind: "binary_op", op: "+", lhs: 1.5, rhs: 2 },
        emptyScope,
      ),
    ).toBe(3.5);
    expect(
      evaluateExpression(
        { $kind: "binary_op", op: "+", lhs: "a", rhs: "b" },
        emptyScope,
      ),
    ).toBe("ab");
  });

  it("returns the fallback when types don't match", () => {
    expect(
      evaluateExpression(
        { $kind: "binary_op", op: "<", lhs: "a", rhs: 1 },
        emptyScope,
        { fallback: "?" },
      ),
    ).toBe("?");
  });
});

describe("unary_op", () => {
  it("negates numbers and booleans", () => {
    expect(
      evaluateExpression({ $kind: "unary_op", op: "-", exp: 3 }, emptyScope),
    ).toBe(-3);
    expect(
      evaluateExpression(
        { $kind: "unary_op", op: "not", exp: true },
        emptyScope,
      ),
    ).toBe(false);
  });
});

describe("if", () => {
  it("evaluates the chosen branch only", () => {
    const e: Expression = {
      $kind: "if",
      condition: true,
      true: 1,
      false: { $kind: "cref", parts: [{ name: "missing" }] }, // unreachable
    };
    expect(evaluateExpression(e, emptyScope)).toBe(1);
  });
});

describe("cref", () => {
  it("resolves a single-segment name from the scope", () => {
    const e: Expression = {
      $kind: "cref",
      parts: [{ name: "k" }],
    };
    expect(evaluateExpression(e, values({ k: 42 }))).toBe(42);
  });

  it("returns undefined for unknown names (caller's fallback wins at the outer call)", () => {
    const e: Expression = {
      $kind: "cref",
      parts: [{ name: "missing" }],
    };
    expect(
      evaluateExpression(e, values({}), { fallback: true }),
    ).toBe(true);
  });

  it("returns undefined for subscripted crefs (out of scope for first cut)", () => {
    const e: Expression = {
      $kind: "cref",
      parts: [{ name: "a", subscripts: [1] }],
    };
    expect(evaluateExpression(e, values({ a: 1 }))).toBeUndefined();
  });
});

describe("call — identity passthrough for semantics wrappers", () => {
  it("treats noEvent / pre / smooth / actualStream as identity on their last argument", () => {
    for (const name of ["noEvent", "pre", "smooth"]) {
      expect(
        evaluateExpression(
          {
            $kind: "call",
            name,
            arguments: [{ $kind: "cref", parts: [{ name: "k" }] }],
          },
          values({ k: 5 }),
        ),
      ).toBe(5);
    }
  });

  it("falls back through scope.callFunction for unknown functions", () => {
    const scope: EvalScope = {
      lookup: () => undefined,
      callFunction: (name, args) =>
        name === "double" && typeof args[0] === "number" ? args[0] * 2 : undefined,
    };
    expect(
      evaluateExpression(
        { $kind: "call", name: "double", arguments: [7] },
        scope,
      ),
    ).toBe(14);
  });
});

describe("realistic Dialog.enable expressions", () => {
  it("evaluates the LimPID Ti.Dialog.enable shape", () => {
    // (PI.controllerType == T.PI) or (PI.controllerType == T.PID)
    const e: Expression = {
      $kind: "binary_op",
      op: "or",
      lhs: {
        $kind: "binary_op",
        op: "==",
        lhs: {
          $kind: "cref",
          parts: [{ name: "PI" }, { name: "controllerType" }],
        },
        rhs: { $kind: "enum", name: "T.PI", index: 2 },
      },
      rhs: {
        $kind: "binary_op",
        op: "==",
        lhs: {
          $kind: "cref",
          parts: [{ name: "PI" }, { name: "controllerType" }],
        },
        rhs: { $kind: "enum", name: "T.PID", index: 4 },
      },
    };
    const inner = recordScope({
      controllerType: { $kind: "enum", name: "T.PI" },
    });
    const scope = prefixStrippingScope("PI", inner);
    expect(evaluateExpression(e, scope)).toBe(true);

    const scopePD = prefixStrippingScope(
      "PI",
      recordScope({ controllerType: { $kind: "enum", name: "T.PD" } }),
    );
    expect(evaluateExpression(e, scopePD)).toBe(false);
  });

  it("respects the outer fallback when a cref is unresolved", () => {
    const e: Expression = {
      $kind: "binary_op",
      op: "==",
      lhs: { $kind: "cref", parts: [{ name: "missing" }] },
      rhs: 1,
    };
    expect(
      evaluateExpression(e, emptyScope, { fallback: true }),
    ).toBe(true);
  });
});
