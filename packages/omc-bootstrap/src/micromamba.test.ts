import { describe, expect, it } from "vitest";

import { condaSubdir, micromambaRelease } from "./micromamba.js";

const SUBDIRS = ["linux-64", "linux-aarch64", "osx-64", "osx-arm64"] as const;

describe("condaSubdir", () => {
  it("names the four platforms conda-forge builds OpenModelica for", () => {
    expect(condaSubdir("linux", "x64")).toBe("linux-64");
    expect(condaSubdir("linux", "arm64")).toBe("linux-aarch64");
    expect(condaSubdir("darwin", "x64")).toBe("osx-64");
    expect(condaSubdir("darwin", "arm64")).toBe("osx-arm64");
  });

  it("has no answer for Windows, so no install can be offered there", () => {
    expect(condaSubdir("win32", "x64")).toBeUndefined();
    expect(condaSubdir("win32", "arm64")).toBeUndefined();
  });

  it("has no answer for an architecture with no build", () => {
    expect(condaSubdir("linux", "ppc64")).toBeUndefined();
    expect(condaSubdir("darwin", "ia32")).toBeUndefined();
  });
});

describe("micromambaRelease", () => {
  it("pins one tag across every platform, so a bump cannot be partial", () => {
    const tags = SUBDIRS.map((subdir) => micromambaRelease(subdir).url).map(
      (url) => url.split("/download/")[1]?.split("/")[0],
    );

    expect(new Set(tags).size).toBe(1);
  });

  it("carries a digest for every platform it offers", () => {
    for (const subdir of SUBDIRS) {
      const release = micromambaRelease(subdir);
      expect(release.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(release.url).toContain(`micromamba-${subdir}`);
    }
  });

  it("gives each platform its own binary", () => {
    const digests = SUBDIRS.map((subdir) => micromambaRelease(subdir).sha256);

    expect(new Set(digests).size).toBe(4);
  });
});
