import { describe, expect, it, vi } from "vitest";

import {
  PACKAGE_FILE,
  owningClassFromQualifiedName,
  resolveOwningClass,
  type FileProbe,
  type OwningClassClient,
} from "./owning-class.js";

function probeFor(existing: string[]): FileProbe {
  const set = new Set(existing);
  return (p) => Promise.resolve(set.has(p));
}

function clientFor(byFile: Record<string, string[]>): OwningClassClient {
  return {
    parseFile: vi.fn(({ fileName }) =>
      Promise.resolve({ classNames: byFile[fileName] ?? [] }),
    ),
  };
}

describe("resolveOwningClass — single-file layout", () => {
  it("derives the class name from the filename when no package above", async () => {
    const result = await resolveOwningClass("/work/Foo.mo", {
      probe: probeFor([]),
    });
    expect(result).toEqual({ qualifiedName: "Foo", fileName: "/work/Foo.mo" });
  });

  it("prefixes with ancestor packages from the package.mo walk", async () => {
    const result = await resolveOwningClass("/lib/A/B/Foo.mo", {
      probe: probeFor([`/lib/A/${PACKAGE_FILE}`, `/lib/A/B/${PACKAGE_FILE}`]),
    });
    expect(result?.qualifiedName).toBe("A.B.Foo");
  });

  it("stops the prefix walk at the first non-package ancestor", async () => {
    const result = await resolveOwningClass("/lib/A/B/Foo.mo", {
      probe: probeFor([`/lib/A/B/${PACKAGE_FILE}`]),
    });
    expect(result?.qualifiedName).toBe("B.Foo");
  });
});

describe("resolveOwningClass — package.mo layout", () => {
  it("uses the directory name as the leaf for package.mo", async () => {
    const result = await resolveOwningClass("/lib/A/B/package.mo", {
      probe: probeFor([`/lib/A/${PACKAGE_FILE}`, `/lib/A/B/${PACKAGE_FILE}`]),
    });
    expect(result?.qualifiedName).toBe("A.B");
  });

  it("handles a top-level package directory", async () => {
    const result = await resolveOwningClass("/work/MyLib/package.mo", {
      probe: probeFor([`/work/MyLib/${PACKAGE_FILE}`]),
    });
    expect(result?.qualifiedName).toBe("MyLib");
  });
});

describe("resolveOwningClass — parseFile confirmation", () => {
  it("prefers the single class name parseFile reports over the filename", async () => {
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

  it("takes the last segment when parseFile returns a qualified within-name", async () => {
    // Prefix `A` comes from the package walk; keep only the `Foo` leaf.
    const client = clientFor({ "/lib/A/Foo.mo": ["A.Foo"] });
    const result = await resolveOwningClass("/lib/A/Foo.mo", {
      probe: probeFor([`/lib/A/${PACKAGE_FILE}`]),
      client,
    });
    expect(result?.qualifiedName).toBe("A.Foo");
  });

  it("falls back to the filename candidate when parseFile is ambiguous", async () => {
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
    expect(
      await resolveOwningClass("", { probe: probeFor([]) }),
    ).toBeUndefined();
  });

  it("returns undefined for a non-`.mo` path", async () => {
    // Without the extension guard, `Foo.txt` would leak `.txt` into the leaf.
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

describe("owningClassFromQualifiedName — virtual source path", () => {
  it("takes the dotted basename verbatim as the FQN (no fileName)", () => {
    expect(
      owningClassFromQualifiedName("/Modelica.Electrical.Resistor.mo"),
    ).toEqual({ qualifiedName: "Modelica.Electrical.Resistor" });
  });

  it("is synchronous and takes no probe / parseFile", () => {
    expect(owningClassFromQualifiedName("/A.B.C.mo")).toEqual({
      qualifiedName: "A.B.C",
    });
  });

  it("returns undefined when the virtual basename is empty", () => {
    expect(owningClassFromQualifiedName("/.mo")).toBeUndefined();
  });

  it("returns undefined for a non-`.mo` path", () => {
    expect(owningClassFromQualifiedName("/A.B.C.txt")).toBeUndefined();
  });

  it("returns undefined for an empty path", () => {
    expect(owningClassFromQualifiedName("")).toBeUndefined();
  });
});
