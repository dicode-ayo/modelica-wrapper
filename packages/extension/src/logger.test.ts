import { describe, expect, it } from "vitest";

import { bounded, MAX_LINE_CHARS } from "./logger.js";

describe("bounded", () => {
  it("passes a line at or under the bound through unchanged", () => {
    const line = "x".repeat(MAX_LINE_CHARS);
    expect(bounded(line)).toBe(line);
  });

  it("keeps the truncated line, suffix included, within the declared bound", () => {
    const line = "x".repeat(MAX_LINE_CHARS + 5000);

    const result = bounded(line);

    expect(result.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
    expect(result).toContain(`${line.length} chars total`);
  });
});
