import { describe, expect, it, vi } from "vitest";

import { multipleTopLevelClasses, renamedClass } from "./single-entity-file.js";

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

  it("leaves a multi-class buffer to the multiple-top-level-classes screen", () => {
    expect(renamedClass(["Foo", "Bar"], "Foo")).toBeUndefined();
  });

  it("passes an empty buffer, leaving the load to report the parse failure", () => {
    expect(renamedClass([], "Foo")).toBeUndefined();
  });
});
