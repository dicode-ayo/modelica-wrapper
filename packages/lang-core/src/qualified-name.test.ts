import { describe, expect, it } from "vitest";

import {
  enclosingScope,
  isWithinScope,
  lastUnquotedDotIndex,
  leafName,
  scopeChain,
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

  it("returns everything before a trailing dot", () => {
    expect(enclosingScope("Pkg.")).toBe("Pkg");
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

describe("isWithinScope", () => {
  it("holds for the scope itself and every class nested inside it", () => {
    expect(isWithinScope("Demo.Sub", "Demo.Sub")).toBe(true);
    expect(isWithinScope("Demo.Sub.A.B", "Demo.Sub")).toBe(true);
  });

  it("does not hold for a sibling sharing the scope's text as a prefix", () => {
    expect(isWithinScope("Demo.SubOther", "Demo.Sub")).toBe(false);
    expect(isWithinScope("Demo", "Demo.Sub")).toBe(false);
  });

  it("matches a quoted segment whole, never a prefix inside its quotes", () => {
    expect(isWithinScope("Demo.'a.b'.C", "Demo.'a.b'")).toBe(true);
    expect(isWithinScope("Demo.'a.b'.C", "Demo.'a")).toBe(false);
    expect(isWithinScope("Demo.'a.b'", "Demo.'a.b")).toBe(false);
  });
});

describe("scopeChain", () => {
  it("starts at the name itself and walks outward to its outermost segment", () => {
    expect(scopeChain("A.B.C")).toEqual(["A.B.C", "A.B", "A"]);
    expect(scopeChain("A")).toEqual(["A"]);
  });

  it("is empty for the empty name, which no class has", () => {
    expect(scopeChain("")).toEqual([]);
  });

  it("never stops inside a quoted segment", () => {
    expect(scopeChain("Demo.'a.b'.C")).toEqual([
      "Demo.'a.b'.C",
      "Demo.'a.b'",
      "Demo",
    ]);
  });
});
