import { describe, expect, it } from "vitest";

import { sanitizeIdentifier } from "./context.js";

describe("sanitizeIdentifier", () => {
  it("passes through a valid identifier unchanged", () => {
    expect(sanitizeIdentifier("MyLib")).toBe("MyLib");
    expect(sanitizeIdentifier("_private")).toBe("_private");
    expect(sanitizeIdentifier("Foo_Bar_123")).toBe("Foo_Bar_123");
  });

  it("replaces spaces and hyphens with underscores", () => {
    expect(sanitizeIdentifier("my lib")).toBe("my_lib");
    expect(sanitizeIdentifier("my-lib")).toBe("my_lib");
    expect(sanitizeIdentifier("my lib-name")).toBe("my_lib_name");
  });

  it("prepends underscore when result starts with a digit", () => {
    expect(sanitizeIdentifier("1stPackage")).toBe("_1stPackage");
    expect(sanitizeIdentifier("123abc")).toBe("_123abc");
  });

  it("handles collapses repeated invalid chars into one underscore", () => {
    expect(sanitizeIdentifier("a--b")).toBe("a_b");
    expect(sanitizeIdentifier("a  b")).toBe("a_b");
  });

  it("falls back to underscore for empty or all-invalid input", () => {
    expect(sanitizeIdentifier("")).toBe("_");
    expect(sanitizeIdentifier("---")).toBe("_");
    expect(sanitizeIdentifier("...")).toBe("_");
  });
});
