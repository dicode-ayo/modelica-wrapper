import { REGISTRY } from "@dicode/omc-client";
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

describe("errorDetail: caps a large OMC diagnostic (#658)", () => {
  it("passes a short multi-line message through unchanged", () => {
    const message = "Error: element R already declared\nat line 12";
    expect(errorDetail(new Error(message))).toBe(message);
  });

  it("keeps the head and elides the rest, with a count, for a class-dump-sized reply", () => {
    // Mirrors OMC's "the available classes were: ..." refusal — one loaded
    // class per line, thousands of lines, hundreds of KB — the 356 KB
    // `createClass` repro from the issue.
    const lines = Array.from(
      { length: 6411 },
      (_, i) => `Modelica.Blocks.Examples.Class${i}`,
    );
    const message = `Error: class "Nope.Missing" not found, the available classes were:\n${lines.join("\n")}`;

    const detail = errorDetail(new Error(message));

    expect(detail.length).toBeLessThan(message.length);
    expect(detail.startsWith('Error: class "Nope.Missing" not found')).toBe(
      true,
    );
    expect(detail).toMatch(/\n\.\.\.\n\[\+6352 more lines elided\]$/);
    expect(detail).not.toContain("Class6410");
  });

  it("elides a single very long line by character count instead of leaving it whole", () => {
    const message = "Error: " + "x".repeat(10_000);

    const detail = errorDetail(new Error(message));

    expect(detail.length).toBeLessThan(message.length);
    expect(detail).toMatch(/\n\.\.\.\n\[\+\d+ more characters elided\]$/);
  });
});

/**
 * The same three shapes, against `@dicode/omc-client`'s real per-function
 * schemas rather than ones built for this file — the schema `OmcClient.invoke`
 * actually parses against. No `OmcClient` needed: a schema failure is
 * decided before any OMC call would be made.
 */
describe("errorDetail against the real OMC registry schemas", () => {
  it("renders getElements' wrong-typed typeName", () => {
    const err = zodFailure(REGISTRY.getElements.inputSchema, { typeName: 42 });

    expect(errorDetail(err, "getElements")).toBe(
      "getElements.typeName: Invalid input: expected string, received number",
    );
  });

  it("renders addComponent's two missing required arguments", () => {
    const err = zodFailure(REGISTRY.addComponent.inputSchema, {
      componentName: "r1",
    });

    expect(errorDetail(err, "addComponent")).toBe(
      [
        "addComponent.componentClass: Invalid input: expected string, received undefined",
        "addComponent.intoTypeName: Invalid input: expected string, received undefined",
      ].join("\n"),
    );
  });

  it("keeps getElements' modelicaName message for a bad typeName", () => {
    const err = zodFailure(REGISTRY.getElements.inputSchema, {
      typeName: "not a name)",
    });

    expect(errorDetail(err, "getElements")).toBe(
      "getElements.typeName: must be a Modelica name — dot-separated identifiers, " +
        'each optionally subscripted (e.g. "Modelica.Blocks.Math.Gain", "pins[3].p"), ' +
        "or a single-quoted Q-IDENT",
    );
  });
});
