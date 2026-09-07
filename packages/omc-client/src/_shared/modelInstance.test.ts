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

  it("drops only the array value itself, keeping the entry it sat on", () => {
    // A redeclare's `$value` can carry a `scodeElement` whose `dims` is an
    // array, which `Modifier` has no branch for. Rejecting the whole entry
    // here would fail the whole instance parse; degrading per key instead
    // strips just the array (wherever it sits) and keeps the rest of the
    // structure around it — `$type` survives, so copy-paste.ts's own
    // redeclare-entry check still sees it and drops the entry when writing
    // a declaration back out.
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
    expect(replaceable.modifiers).toEqual({
      redeclareThing: { $type: "Foo", $value: { dims: {} } },
    });
  });

  it("keeps a well-formed sibling entry when another entry's own value is an array", () => {
    // `z.record` fails atomically on one bad value, so a `.catch()` scoped to
    // the whole `modifiers` field would drop every sibling right along with
    // the one that can't parse. Degrading per key instead means a perfectly
    // representable `singleState=true` doesn't vanish just because
    // `badArray` sits next to it.
    const result = PrefixesSchema.safeParse({
      replaceable: {
        constrainedby: "Modelica.Media.Interfaces.PartialMedium",
        modifiers: {
          singleState: { $value: "true" },
          badArray: ["1", "2"],
        },
      },
    });
    expect(result.success).toBe(true);
    const replaceable = result.data?.replaceable;
    if (typeof replaceable !== "object") {
      throw new Error("expected the constraint object, not a boolean");
    }
    expect(replaceable.modifiers).toEqual({ singleState: { $value: "true" } });
  });
});
