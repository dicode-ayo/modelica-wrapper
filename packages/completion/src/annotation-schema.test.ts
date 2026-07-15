import { describe, expect, it } from "vitest";

import { ANNOTATION_ENUM_NAMES } from "./annotation-schema.js";

describe("ANNOTATION_ENUM_NAMES", () => {
  it("holds the graphical-enum names", () => {
    expect(ANNOTATION_ENUM_NAMES.has("LinePattern")).toBe(true);
    expect(ANNOTATION_ENUM_NAMES.has("FillPattern")).toBe(true);
    expect(ANNOTATION_ENUM_NAMES.has("Smooth")).toBe(true);
    expect(ANNOTATION_ENUM_NAMES.has("Arrow")).toBe(true);
  });

  it("derives nothing from boolean-valued fields (no dot)", () => {
    // `visible`/`preserveAspectRatio` carry `true`/`false`, not `Enum.Member`;
    // a naive `slice(0, indexOf("."))` would leak `"tru"`/`"fals"`.
    expect(ANNOTATION_ENUM_NAMES.has("tru")).toBe(false);
    expect(ANNOTATION_ENUM_NAMES.has("fals")).toBe(false);
    for (const name of ANNOTATION_ENUM_NAMES) {
      expect(name).not.toContain(".");
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
