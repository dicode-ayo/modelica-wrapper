import { describe, expect, it } from "vitest";
import { z } from "zod";

import { formatSchemaMismatch } from "./formatSchemaMismatch.js";

const Element = z.discriminatedUnion("$kind", [
  z.object({ $kind: z.literal("component"), name: z.string() }),
  z.object({ $kind: z.literal("extends") }),
]);
const Schema = z.object({
  instance: z.object({
    elements: z.array(
      z.union([
        z.string(),
        z.object({ type: z.object({ elements: z.array(Element) }) }),
      ]),
    ),
  }),
});

function failure(data: unknown, cmd = "getModelInstance"): string {
  const result = Schema.safeParse(data);
  if (result.success) throw new Error("expected a parse failure");
  return formatSchemaMismatch(cmd, result.error);
}

describe("formatSchemaMismatch", () => {
  it("reports the deepest union branch under the union's own path", () => {
    const text = failure({
      instance: {
        elements: [
          "a",
          "b",
          {
            type: {
              elements: [{ $kind: "component", name: "x" }, { $kind: "bogus" }],
            },
          },
        ],
      },
    });
    expect(text).toBe(
      [
        "OMC response shape mismatch for getModelInstance:",
        "  instance.elements[2].type.elements[1].$kind: Invalid discriminator value. Expected 'component' | 'extends'",
      ].join("\n"),
    );
  });

  it("emits no JSON syntax", () => {
    expect(failure({ instance: { elements: [1] } })).not.toMatch(/[{}"]/);
  });

  it("lists plain issues one per line", () => {
    const text = failure({ instance: { elements: "no" } });
    expect(text).toBe(
      [
        "OMC response shape mismatch for getModelInstance:",
        "  instance.elements: Invalid input: expected array, received string",
      ].join("\n"),
    );
  });

  it("caps the number of lines and counts the rest", () => {
    const text = failure({
      instance: {
        elements: Array.from({ length: 14 }, () => ({
          type: { elements: "x" },
        })),
      },
    });
    const lines = text.split("\n");
    expect(lines).toHaveLength(12);
    expect(lines.at(-1)).toBe("  … and 4 more");
  });
});
