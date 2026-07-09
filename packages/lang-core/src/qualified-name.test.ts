import { describe, expect, it } from "vitest";

import {
  enclosingScope,
  lastUnquotedDotIndex,
  leafName,
} from "./qualified-name.js";

describe("leafName", () => {
  it("returns the trailing dotted segment", () => {
    expect(leafName("Modelica.Blocks.Math.Gain")).toBe("Gain");
    expect(leafName("Complex")).toBe("Complex");
  });

  it("does not split inside a quoted identifier containing a dot", () => {
    expect(leafName("Pkg.'a.b'")).toBe("'a.b'");
    expect(leafName("Complex.'a.b'.negate")).toBe("negate");
  });

  it("handles operator-name quoted identifiers with no dot inside", () => {
    expect(leafName("Complex.'-'.negate")).toBe("negate");
    expect(leafName("Complex.'constructor'.fromReal")).toBe("fromReal");
  });

  it("skips an escaped quote inside the quoted segment", () => {
    expect(leafName(String.raw`Pkg.'a\'.b'.Leaf`)).toBe("Leaf");
  });

  it("falls back to the whole name for a trailing dot", () => {
    expect(leafName("Pkg.")).toBe("Pkg.");
  });
});

describe("enclosingScope", () => {
  it("returns everything before the trailing segment", () => {
    expect(enclosingScope("Modelica.Blocks.Math.Gain")).toBe(
      "Modelica.Blocks.Math",
    );
    expect(enclosingScope("Complex")).toBe("");
  });

  it("does not split inside a quoted identifier containing a dot", () => {
    expect(enclosingScope("Pkg.'a.b'")).toBe("Pkg");
    expect(enclosingScope("Complex.'a.b'.negate")).toBe("Complex.'a.b'");
  });
});

describe("lastUnquotedDotIndex", () => {
  it("returns -1 for a name with no dot", () => {
    expect(lastUnquotedDotIndex("Complex")).toBe(-1);
  });

  it("ignores dots inside quoted segments entirely", () => {
    expect(lastUnquotedDotIndex("'a.b.c'")).toBe(-1);
  });
});
