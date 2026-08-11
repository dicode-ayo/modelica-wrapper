import { describe, expect, it, vi } from "vitest";

import { multipleTopLevelClasses } from "./single-entity-file.js";

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
