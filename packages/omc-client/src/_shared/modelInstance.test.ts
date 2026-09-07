import { describe, expect, it } from "vitest";

import { PrefixesSchema } from "./modelInstance.js";

describe("PrefixesSchema.replaceable", () => {
  it("accepts a bare boolean", () => {
    const result = PrefixesSchema.safeParse({ replaceable: true });
    expect(result.success).toBe(true);
    expect(result.data?.replaceable).toBe(true);
  });

  it("accepts a constraining clause with a well-formed modifier tree", () => {
    const result = PrefixesSchema.safeParse({
      replaceable: {
        constrainedby: "Modelica.Media.Interfaces.PartialMedium",
        modifiers: { singleState: { final: true, $value: "true" } },
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.replaceable).toEqual({
      constrainedby: "Modelica.Media.Interfaces.PartialMedium",
      modifiers: { singleState: { final: true, $value: "true" } },
    });
  });

  it("degrades an unrepresentable modifier tree to undefined", () => {
    // A redeclare's `$value` can carry a `scodeElement` whose
    // `dims`/`annotation` are arrays, which `Modifier` has no branch for.
    // Rejecting here would fail the whole instance parse.
    const result = PrefixesSchema.safeParse({
      replaceable: {
        constrainedby: "Modelica.Media.Interfaces.PartialMedium",
        modifiers: {
          redeclareThing: {
            $type: "Foo",
            $value: { dims: { absyn: ["1", "2"], typed: ["1", "2"] } },
          },
        },
      },
    });
    expect(result.success).toBe(true);
    const replaceable = result.data?.replaceable;
    if (typeof replaceable !== "object") {
      throw new Error("expected the constraint object, not a boolean");
    }
    expect(replaceable.constrainedby).toBe(
      "Modelica.Media.Interfaces.PartialMedium",
    );
    expect(replaceable.modifiers).toBeUndefined();
  });
});
