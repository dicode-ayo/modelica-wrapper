/**
 * Unit tests for the document-URI → owning-class mapping.
 *
 * The filesystem is an in-memory set of `package.mo` paths (the {@link FileProbe}
 * injection point) and `parseFile` is a plain stub — no real disk, no live OMC.
 */

import { describe, expect, it, vi } from "vitest";

import {
  PACKAGE_FILE,
  resolveOwningClass,
  type FileProbe,
  type OwningClassClient,
} from "./owning-class.js";

/** A probe that reports a fixed set of existing absolute paths. */
function probeFor(existing: string[]): FileProbe {
  const set = new Set(existing);
  return (p) => Promise.resolve(set.has(p));
}

/** A stub `parseFile` client returning the given class names per file. */
function clientFor(byFile: Record<string, string[]>): OwningClassClient {
  return {
    parseFile: vi.fn(({ fileName }) =>
      Promise.resolve({ classNames: byFile[fileName] ?? [] }),
    ),
  };
}

describe("resolveOwningClass — single-file layout", () => {
  it("derives the class name from the filename when no package above", async () => {
    // /work/Foo.mo, no package.mo anywhere → owning class is `Foo`.
    const result = await resolveOwningClass("/work/Foo.mo", {
      probe: probeFor([]),
    });
    expect(result).toEqual({ qualifiedName: "Foo", fileName: "/work/Foo.mo" });
  });

  it("prefixes with ancestor packages from the package.mo walk", async () => {
    // /lib/A/B/Foo.mo with A and B both packages → `A.B.Foo`.
    const result = await resolveOwningClass("/lib/A/B/Foo.mo", {
      probe: probeFor([`/lib/A/${PACKAGE_FILE}`, `/lib/A/B/${PACKAGE_FILE}`]),
    });
    expect(result?.qualifiedName).toBe("A.B.Foo");
  });

  it("stops the prefix walk at the first non-package ancestor", async () => {
    // Only B is a package; A is not → prefix is just `B`, giving `B.Foo`.
    const result = await resolveOwningClass("/lib/A/B/Foo.mo", {
      probe: probeFor([`/lib/A/B/${PACKAGE_FILE}`]),
    });
    expect(result?.qualifiedName).toBe("B.Foo");
  });
});

describe("resolveOwningClass — package.mo layout", () => {
  it("uses the directory name as the leaf for package.mo", async () => {
    // /lib/A/B/package.mo → owning class is the package `A.B`.
    const result = await resolveOwningClass("/lib/A/B/package.mo", {
      probe: probeFor([`/lib/A/${PACKAGE_FILE}`, `/lib/A/B/${PACKAGE_FILE}`]),
    });
    expect(result?.qualifiedName).toBe("A.B");
  });

  it("handles a top-level package directory", async () => {
    // /work/MyLib/package.mo, MyLib is the only package → `MyLib`.
    const result = await resolveOwningClass("/work/MyLib/package.mo", {
      probe: probeFor([`/work/MyLib/${PACKAGE_FILE}`]),
    });
    expect(result?.qualifiedName).toBe("MyLib");
  });
});

describe("resolveOwningClass — parseFile confirmation", () => {
  it("prefers the single class name parseFile reports over the filename", async () => {
    // File is `Renamed.mo` but declares `class Actual` → leaf is `Actual`.
    const client = clientFor({ "/lib/A/Renamed.mo": ["Actual"] });
    const result = await resolveOwningClass("/lib/A/Renamed.mo", {
      probe: probeFor([`/lib/A/${PACKAGE_FILE}`]),
      client,
    });
    expect(result?.qualifiedName).toBe("A.Actual");
    expect(client.parseFile).toHaveBeenCalledWith({
      fileName: "/lib/A/Renamed.mo",
    });
  });

  it("takes the last segment when parseFile returns a qualified name", async () => {
    // A within-clause file reports the fully-qualified `A.Foo`; the package
    // walk already supplies `A`, so we keep only the leaf `Foo` → `A.Foo`.
    const client = clientFor({ "/lib/A/Foo.mo": ["A.Foo"] });
    const result = await resolveOwningClass("/lib/A/Foo.mo", {
      probe: probeFor([`/lib/A/${PACKAGE_FILE}`]),
      client,
    });
    expect(result?.qualifiedName).toBe("A.Foo");
  });

  it("falls back to the filename candidate when parseFile is ambiguous", async () => {
    // Two declared classes → ambiguous; keep the filename-derived `Foo`.
    const client = clientFor({ "/work/Foo.mo": ["Foo", "Bar"] });
    const result = await resolveOwningClass("/work/Foo.mo", {
      probe: probeFor([]),
      client,
    });
    expect(result?.qualifiedName).toBe("Foo");
  });

  it("falls back to the filename candidate when parseFile throws", async () => {
    const client: OwningClassClient = {
      parseFile: vi.fn(() => Promise.reject(new Error("not loadable"))),
    };
    const result = await resolveOwningClass("/work/Foo.mo", {
      probe: probeFor([]),
      client,
    });
    expect(result?.qualifiedName).toBe("Foo");
  });
});

describe("resolveOwningClass — degenerate input", () => {
  it("returns undefined for an empty path", async () => {
    expect(await resolveOwningClass("", { probe: probeFor([]) })).toBeUndefined();
  });

  it("returns undefined for a non-`.mo` path (no bogus dotted leaf)", async () => {
    // Without the extension guard, `Foo.txt` would survive stripMoExtension and
    // produce a leaf of `Foo.txt`, contaminating the qualified name with a stray
    // `.txt` segment. The guard rejects it outright.
    expect(
      await resolveOwningClass("/work/Foo.txt", { probe: probeFor([]) }),
    ).toBeUndefined();
  });

  it("accepts a `.mo` path regardless of case in the extension", async () => {
    const result = await resolveOwningClass("/work/Foo.MO", {
      probe: probeFor([]),
    });
    expect(result?.qualifiedName).toBe("Foo");
  });
});
