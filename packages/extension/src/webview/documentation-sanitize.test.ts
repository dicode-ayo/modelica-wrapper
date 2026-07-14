/**
 * The render-vs-empty-state decision the documentation webview makes after
 * sanitizing. DOMPurify's own stripping needs a DOM and is the library's tested
 * contract; what we own is the whitespace-collapse decision — a fragment that
 * sanitizes to nothing (e.g. a `<script>`-only `info`) must surface the empty
 * state rather than an empty document body.
 */

import { describe, expect, it } from "vitest";

import { classifySanitized } from "./documentation-sanitize.js";

describe("classifySanitized", () => {
  it("treats an empty fragment as empty", () => {
    expect(classifySanitized("").isEmpty).toBe(true);
  });

  it("treats a whitespace-only fragment as empty", () => {
    expect(classifySanitized("  \n\t ").isEmpty).toBe(true);
  });

  it("keeps real content and reports it non-empty", () => {
    const doc = classifySanitized("<p>x</p>");
    expect(doc.isEmpty).toBe(false);
    expect(doc.html).toBe("<p>x</p>");
  });
});
