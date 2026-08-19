import { describe, expect, it, vi } from "vitest";

import {
  classNamesRefusal,
  multipleTopLevelClasses,
  renamedClass,
  renamedClassMessage,
} from "./single-entity-file.js";

function client(result: { classNames: string[] } | Error) {
  return {
    parseFile: vi.fn(() =>
      result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result),
    ),
  };
}

describe("multipleTopLevelClasses", () => {
  it("names the classes when a file declares more than one (#452)", async () => {
    expect(
      await multipleTopLevelClasses(
        client({ classNames: ["A", "B"] }),
        "AB.mo",
      ),
    ).toEqual(["A", "B"]);
  });

  it("names them for a `within`-qualified file too", async () => {
    // OMC qualifies `parseFile` output with the file's `within` clause, so the
    // refusal must not key off the names being top-level in the dotted sense.
    expect(
      await multipleTopLevelClasses(
        client({ classNames: ["Foo.C", "Foo.D"] }),
        "CD.mo",
      ),
    ).toEqual(["Foo.C", "Foo.D"]);
  });

  it("passes a single-entity file", async () => {
    expect(
      await multipleTopLevelClasses(client({ classNames: ["M"] }), "M.mo"),
    ).toBeUndefined();
  });

  it("passes a file OMC could not parse, leaving the load to report it", async () => {
    expect(
      await multipleTopLevelClasses(client({ classNames: [] }), "Broken.mo"),
    ).toBeUndefined();
    expect(
      await multipleTopLevelClasses(client(new Error("omc down")), "Gone.mo"),
    ).toBeUndefined();
  });
});

describe("renamedClass", () => {
  it("names the class a buffer declares when it isn't the one expected (#459)", () => {
    expect(renamedClass(["Foo2"], "Foo")).toBe("Foo2");
  });

  it("passes a buffer that still declares the expected class", () => {
    expect(renamedClass(["Foo"], "Foo")).toBeUndefined();
  });

  it("compares leaf segments, so a within-qualified answer matches an unqualified member buffer", () => {
    // `parseString` may qualify a member's declared name with its `within`
    // clause the same way `parseFile` does; a bare buffer with no `within`
    // clause of its own must not read as a rename against a dotted expected.
    expect(renamedClass(["Pkg.M"], "Pkg.M")).toBeUndefined();
    expect(renamedClass(["M"], "Pkg.M")).toBeUndefined();
  });

  it("still catches a rename under a qualified name", () => {
    expect(renamedClass(["Pkg.M2"], "Pkg.M")).toBe("Pkg.M2");
  });

  it("catches a within-clause move that keeps the same leaf name", () => {
    // Leaf-only comparison would miss this: `M`'s leaf is unchanged, but the
    // qualified answer now names a different scope than `expected` — a
    // different class, and #459's failure mode all the same.
    expect(renamedClass(["Other.M"], "Pkg.M")).toBe("Other.M");
  });

  it("leaves a multi-class buffer to the multiple-top-level-classes screen", () => {
    expect(renamedClass(["Foo", "Bar"], "Foo")).toBeUndefined();
  });

  it("passes an empty buffer, leaving the load to report the parse failure", () => {
    expect(renamedClass([], "Foo")).toBeUndefined();
  });
});

describe("renamedClassMessage", () => {
  it("names a save as the consequence by default", () => {
    expect(renamedClassMessage("Foo", "Bar")).toContain("Saving here");
  });

  it("takes a caller's consequence over the default", () => {
    expect(
      renamedClassMessage("Foo", "Bar", (name) => `Loading ${name} would stop`),
    ).toContain("Loading Foo would stop");
  });
});

describe("classNamesRefusal", () => {
  it("refuses a multi-entity buffer ahead of the rename screen", () => {
    // Both screens would fire on their own inputs here; multi-entity must win.
    expect(
      classNamesRefusal(["Foo", "Bar"], {
        filename: "F.mo",
        expected: "Foo",
      }),
    ).toContain("Foo, Bar");
  });

  it("refuses a single-class buffer that renamed away from `expected`", () => {
    expect(
      classNamesRefusal(["Foo2"], { filename: "F.mo", expected: "Foo" }),
    ).toContain("Foo2");
  });

  it("passes a buffer that still declares the expected class", () => {
    expect(
      classNamesRefusal(["Foo"], { filename: "F.mo", expected: "Foo" }),
    ).toBeUndefined();
  });

  it("skips the rename screen for a caller with no expected class, still runs the multi-entity one", () => {
    expect(
      classNamesRefusal(["AnythingAtAll"], {
        filename: "F.mo",
        expected: undefined,
      }),
    ).toBeUndefined();
    expect(
      classNamesRefusal(["Foo", "Bar"], {
        filename: "F.mo",
        expected: undefined,
      }),
    ).toContain("Foo, Bar");
  });

  it("names the multi-entity refusal by `label` over `filename` when given", () => {
    expect(
      classNamesRefusal(["Foo", "Bar"], {
        filename: "F.mo",
        expected: "Foo",
        label: "Pkg.Foo",
      }),
    ).toContain("Pkg.Foo");
  });

  it("passes `renamedConsequence` through to the rename refusal", () => {
    expect(
      classNamesRefusal(["Foo2"], {
        filename: "F.mo",
        expected: "Foo",
        renamedConsequence: (name) => `Loading ${name} would stop`,
      }),
    ).toContain("Loading Foo would stop");
  });
});
