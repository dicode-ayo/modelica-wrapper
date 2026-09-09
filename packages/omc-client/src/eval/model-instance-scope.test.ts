import { describe, expect, it } from "vitest";

import type { ModelInstance } from "../_shared/modelInstance.js";
import { modelInstanceScope } from "./model-instance-scope.js";

/** Root model holding one component `t` of a type declaring `useSupport`. */
const HOST: ModelInstance = {
  name: "Cond2",
  restriction: "model",
  elements: [
    {
      $kind: "component",
      name: "t",
      type: {
        name: "Torque",
        restriction: "model",
        elements: [
          {
            $kind: "component",
            name: "useSupport",
            type: "Boolean",
            value: {
              binding: { $kind: "cref", parts: [{ name: "useIt" }] },
              value: false,
            },
          },
        ],
      },
    },
  ],
};

describe("modelInstanceScope", () => {
  it("resolves a dotted path to the value OMC already reduced", () => {
    expect(modelInstanceScope(HOST).lookup(["t", "useSupport"])).toBe(false);
  });

  it("finds a parameter a component inherits rather than declares", () => {
    const inherited: ModelInstance = {
      name: "Cond2",
      restriction: "model",
      elements: [
        {
          $kind: "component",
          name: "t",
          type: {
            name: "Torque",
            restriction: "model",
            elements: [
              {
                $kind: "extends",
                baseClass: {
                  name: "PartialElementaryOneFlangeAndSupport2",
                  restriction: "model",
                  elements: [
                    {
                      $kind: "component",
                      name: "useSupport",
                      type: "Boolean",
                      value: { binding: false },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    };
    expect(modelInstanceScope(inherited).lookup(["t", "useSupport"])).toBe(
      false,
    );
  });

  it("gives no answer when OMC left the reduced value unreduced", () => {
    // `parameter Boolean noDefault;` has nothing to reduce against, so OMC
    // echoes the cref back in `value` rather than folding it.
    const unresolved: ModelInstance = {
      name: "Top",
      restriction: "model",
      elements: [
        { $kind: "component", name: "noDefault", type: "Boolean" },
        {
          $kind: "component",
          name: "a",
          type: {
            name: "Leaf",
            restriction: "model",
            elements: [
              {
                $kind: "component",
                name: "show",
                type: "Boolean",
                value: {
                  binding: { $kind: "cref", parts: [{ name: "noDefault" }] },
                  value: { $kind: "cref", parts: [{ name: "noDefault" }] },
                },
              },
            ],
          },
        },
      ],
    };
    expect(
      modelInstanceScope(unresolved).lookup(["a", "show"]),
    ).toBeUndefined();
  });

  it("terminates on a binding that resolves back to itself", () => {
    const cref = (name: string) => ({ $kind: "cref", parts: [{ name }] });
    const cyclic: ModelInstance = {
      name: "Top",
      restriction: "model",
      elements: [
        { $kind: "component", name: "a", value: { binding: cref("b") } },
        { $kind: "component", name: "b", value: { binding: cref("a") } },
      ],
    };
    expect(modelInstanceScope(cyclic).lookup(["a"])).toBeUndefined();
  });
});
