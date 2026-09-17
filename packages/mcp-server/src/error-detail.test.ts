import { describe, expect, it } from "vitest";
import { z } from "zod";

import { errorDetail } from "./error-detail.js";

/** The `ZodError` a real `entry.inputSchema.parse(input)` failure throws. */
function zodFailure(schema: z.ZodTypeAny, input: unknown): z.ZodError {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected the parse to fail");
  return result.error;
}

describe("errorDetail", () => {
  it("renders a wrong-type argument as one line naming the function and the argument path", () => {
    const schema = z.strictObject({ typeName: z.string() });
    const err = zodFailure(schema, { typeName: 42 });

    expect(errorDetail(err, "getElements")).toBe(
      "getElements.typeName: Invalid input: expected string, received number",
    );
  });

  it("renders one line per missing required argument", () => {
    const schema = z.strictObject({
      componentClass: z.string(),
      intoTypeName: z.string(),
    });
    const err = zodFailure(schema, {});

    expect(errorDetail(err, "addComponent")).toBe(
      [
        "addComponent.componentClass: Invalid input: expected string, received undefined",
        "addComponent.intoTypeName: Invalid input: expected string, received undefined",
      ].join("\n"),
    );
  });

  it("keeps a regex field's own message, dropping the pattern and the rest of zod's bookkeeping", () => {
    const schema = z.strictObject({
      typeName: z
        .string()
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a Modelica name"),
    });
    const err = zodFailure(schema, { typeName: "not a name)" });

    expect(errorDetail(err, "getElements")).toBe(
      "getElements.typeName: must be a Modelica name",
    );
  });

  it("falls back to the error message for a non-Zod error", () => {
    expect(errorDetail(new Error("boom"))).toBe("boom");
  });
});
