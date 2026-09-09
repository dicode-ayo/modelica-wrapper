/**
 * Unit tests for `scopeForInstance` — the `EvalScope` built directly from a
 * `ModelInstance` tree, backing both graphic-annotation field decoding
 * (`shapes.ts`) and `producer.ts`'s `isConditionTrue`.
 */

import { describe, expect, it } from "vitest";

import { ModelInstanceSchema } from "../../_shared/modelInstance.js";
import { scopeForInstance } from "./eval-scope.js";

function component(overrides: Record<string, unknown>): unknown {
  return { $kind: "component", ...overrides };
}

describe("scopeForInstance", () => {
  it("resolves a single-segment cref to a component's own boolean binding", () => {
    const mi = ModelInstanceSchema.parse({
      name: "Pkg.Host",
      restriction: "model",
      elements: [component({ name: "useSupport", value: { binding: false } })],
    });
    expect(scopeForInstance(mi).lookup(["useSupport"])).toBe(false);
  });

  it("resolves a tagged enum binding to an EnumLiteralValue", () => {
    const mi = ModelInstanceSchema.parse({
      name: "Pkg.Host",
      restriction: "model",
      elements: [
        component({
          name: "controllerType",
          value: {
            binding: {
              $kind: "enum",
              name: "Types.SimpleController.PI",
              index: 2,
            },
          },
        }),
      ],
    });
    expect(scopeForInstance(mi).lookup(["controllerType"])).toEqual({
      $kind: "enum",
      name: "Types.SimpleController.PI",
      index: 2,
    });
  });

  it("returns undefined for a name with no matching component", () => {
    const mi = ModelInstanceSchema.parse({
      name: "Pkg.Host",
      restriction: "model",
      elements: [],
    });
    expect(scopeForInstance(mi).lookup(["missing"])).toBeUndefined();
  });

  it("searches the extends chain, host declaration winning over an ancestor's", () => {
    const ancestor: unknown = {
      name: "Pkg.Base",
      restriction: "model",
      elements: [component({ name: "k", value: { binding: 1 } })],
    };
    const mi = ModelInstanceSchema.parse({
      name: "Pkg.Host",
      restriction: "model",
      elements: [
        { $kind: "extends", baseClass: ancestor },
        component({ name: "k", value: { binding: 2 } }),
      ],
    });
    expect(scopeForInstance(mi).lookup(["k"])).toBe(2);
  });

  it("falls back to an ancestor's declaration when the host doesn't redeclare it", () => {
    const ancestor: unknown = {
      name: "Pkg.Base",
      restriction: "model",
      elements: [component({ name: "k", value: { binding: 1 } })],
    };
    const mi = ModelInstanceSchema.parse({
      name: "Pkg.Host",
      restriction: "model",
      elements: [{ $kind: "extends", baseClass: ancestor }],
    });
    expect(scopeForInstance(mi).lookup(["k"])).toBe(1);
  });

  it("resolves a multi-segment cref through a nested sub-component's own scope", () => {
    const portType: unknown = {
      name: "Pkg.Torque",
      restriction: "model",
      elements: [component({ name: "useSupport", value: { binding: false } })],
    };
    const mi = ModelInstanceSchema.parse({
      name: "Pkg.Host",
      restriction: "model",
      elements: [component({ name: "t", type: portType })],
    });
    expect(scopeForInstance(mi).lookup(["t", "useSupport"])).toBe(false);
  });

  it("returns undefined for a multi-segment cref through a primitively-typed component", () => {
    const mi = ModelInstanceSchema.parse({
      name: "Pkg.Host",
      restriction: "model",
      elements: [component({ name: "t", type: "Real" })],
    });
    expect(scopeForInstance(mi).lookup(["t", "useSupport"])).toBeUndefined();
  });

  it("recurses one level when a binding is itself a cref to another parameter", () => {
    const mi = ModelInstanceSchema.parse({
      name: "Pkg.Host",
      restriction: "model",
      elements: [
        component({
          name: "a",
          value: { binding: { $kind: "cref", parts: [{ name: "b" }] } },
        }),
        component({ name: "b", value: { binding: 42 } }),
      ],
    });
    expect(scopeForInstance(mi).lookup(["a"])).toBe(42);
  });

  it("evaluates a binding that's a richer expression (not just a bare cref)", () => {
    const mi = ModelInstanceSchema.parse({
      name: "Pkg.Host",
      restriction: "model",
      elements: [
        component({
          name: "hidden",
          value: {
            binding: {
              $kind: "unary_op",
              op: "not",
              exp: { $kind: "cref", parts: [{ name: "useSupport" }] },
            },
          },
        }),
        component({ name: "useSupport", value: { binding: false } }),
      ],
    });
    expect(scopeForInstance(mi).lookup(["hidden"])).toBe(true);
  });

  it("returns undefined rather than hanging on a cyclic binding chain", () => {
    const mi = ModelInstanceSchema.parse({
      name: "Pkg.Host",
      restriction: "model",
      elements: [
        component({
          name: "a",
          value: { binding: { $kind: "cref", parts: [{ name: "b" }] } },
        }),
        component({
          name: "b",
          value: { binding: { $kind: "cref", parts: [{ name: "a" }] } },
        }),
      ],
    });
    expect(scopeForInstance(mi).lookup(["a"])).toBeUndefined();
  });

  it("returns undefined for a component with no value at all", () => {
    const mi = ModelInstanceSchema.parse({
      name: "Pkg.Host",
      restriction: "model",
      elements: [component({ name: "unbound" })],
    });
    expect(scopeForInstance(mi).lookup(["unbound"])).toBeUndefined();
  });

  it("falls back to the literal modifier text when there's no value.binding", () => {
    const mi = ModelInstanceSchema.parse({
      name: "Pkg.Host",
      restriction: "model",
      elements: [
        component({ name: "d", modifiers: { $value: "0.5" } }),
        component({ name: "useSupport", modifiers: { $value: "false" } }),
        component({ name: "label", modifiers: { $value: '"rad"' } }),
      ],
    });
    const scope = scopeForInstance(mi);
    expect(scope.lookup(["d"])).toBe(0.5);
    expect(scope.lookup(["useSupport"])).toBe(false);
    expect(scope.lookup(["label"])).toBe("rad");
  });

  it("resolves a literal null binding to null rather than undefined", () => {
    const mi = ModelInstanceSchema.parse({
      name: "Pkg.Host",
      restriction: "model",
      elements: [component({ name: "n", value: { binding: null } })],
    });
    expect(scopeForInstance(mi).lookup(["n"])).toBeNull();
  });
});
