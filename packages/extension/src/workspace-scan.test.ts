/**
 * Unit tests for workspace entry-point discovery. No OMC, no vscode — just
 * fixture directories built in a temp dir.
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverEntryPoints } from "./workspace-scan.js";

describe("discoverEntryPoints", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ws-scan-"));
  });
  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("returns [] for empty roots / nonexistent dir", async () => {
    expect(await discoverEntryPoints([])).toEqual([]);
    expect(
      await discoverEntryPoints([path.join(tmp, "does-not-exist")]),
    ).toEqual([]);
  });

  it("root package.mo wins — siblings aren't enumerated", async () => {
    // When the workspace IS a package, loading <root>/package.mo pulls the
    // whole subtree. We must NOT also enumerate sibling files, or OMC
    // would see them twice (once standalone, once via the package).
    await fsp.writeFile(
      path.join(tmp, "package.mo"),
      "package Root\nend Root;\n",
    );
    await fsp.writeFile(
      path.join(tmp, "Other.mo"),
      "model Other\nend Other;\n",
    );
    await fsp.mkdir(path.join(tmp, "Sub"));
    await fsp.writeFile(
      path.join(tmp, "Sub", "package.mo"),
      "within Root;\npackage Sub\nend Sub;\n",
    );

    expect(await discoverEntryPoints([tmp])).toEqual([
      path.join(tmp, "package.mo"),
    ]);
  });

  it("standalone .mo files at root are picked up", async () => {
    await fsp.writeFile(path.join(tmp, "Foo.mo"), "model Foo\nend Foo;\n");
    await fsp.writeFile(path.join(tmp, "Bar.mo"), "model Bar\nend Bar;\n");
    const found = await discoverEntryPoints([tmp]);
    expect(found.sort()).toEqual(
      [path.join(tmp, "Bar.mo"), path.join(tmp, "Foo.mo")].sort(),
    );
  });

  it("subdirectory packages are picked up via their package.mo", async () => {
    // No root package.mo here, so subdirectories with a package.mo become
    // their own entry points.
    await fsp.mkdir(path.join(tmp, "LibA"));
    await fsp.writeFile(
      path.join(tmp, "LibA", "package.mo"),
      "package LibA\nend LibA;\n",
    );
    await fsp.mkdir(path.join(tmp, "LibB"));
    await fsp.writeFile(
      path.join(tmp, "LibB", "package.mo"),
      "package LibB\nend LibB;\n",
    );
    // A subdirectory WITHOUT package.mo should be ignored.
    await fsp.mkdir(path.join(tmp, "notAPackage"));
    await fsp.writeFile(
      path.join(tmp, "notAPackage", "Foo.mo"),
      "model Foo\nend Foo;\n",
    );

    const found = await discoverEntryPoints([tmp]);
    expect(found.sort()).toEqual(
      [
        path.join(tmp, "LibA", "package.mo"),
        path.join(tmp, "LibB", "package.mo"),
      ].sort(),
    );
  });

  it("mixed: standalone files + subdirectory packages at the same level", async () => {
    await fsp.writeFile(path.join(tmp, "Foo.mo"), "model Foo\nend Foo;\n");
    await fsp.mkdir(path.join(tmp, "LibA"));
    await fsp.writeFile(
      path.join(tmp, "LibA", "package.mo"),
      "package LibA\nend LibA;\n",
    );
    const found = await discoverEntryPoints([tmp]);
    expect(found.sort()).toEqual(
      [path.join(tmp, "Foo.mo"), path.join(tmp, "LibA", "package.mo")].sort(),
    );
  });

  it("skips hidden entries (dotfiles, .git, .vscode, …)", async () => {
    // A `.mo` file inside `.git` should not be loaded as a model — and
    // `.vscode` shouldn't be peeked into for a package.mo either.
    await fsp.mkdir(path.join(tmp, ".git"));
    await fsp.writeFile(
      path.join(tmp, ".git", "something.mo"),
      "model X\nend X;\n",
    );
    await fsp.writeFile(path.join(tmp, ".hidden.mo"), "model H\nend H;\n");
    await fsp.writeFile(path.join(tmp, "Foo.mo"), "model Foo\nend Foo;\n");
    expect(await discoverEntryPoints([tmp])).toEqual([
      path.join(tmp, "Foo.mo"),
    ]);
  });

  it("non-.mo files at root are ignored", async () => {
    await fsp.writeFile(path.join(tmp, "README.md"), "# hi\n");
    await fsp.writeFile(path.join(tmp, "Foo.mo"), "model Foo\nend Foo;\n");
    expect(await discoverEntryPoints([tmp])).toEqual([
      path.join(tmp, "Foo.mo"),
    ]);
  });

  it("multiple workspace roots are scanned independently", async () => {
    const tmp2 = await fsp.mkdtemp(path.join(os.tmpdir(), "ws-scan-2-"));
    try {
      await fsp.writeFile(path.join(tmp, "A.mo"), "model A\nend A;\n");
      await fsp.writeFile(path.join(tmp2, "package.mo"), "package B\nend B;\n");
      const found = await discoverEntryPoints([tmp, tmp2]);
      expect(found).toEqual([
        path.join(tmp, "A.mo"),
        path.join(tmp2, "package.mo"),
      ]);
    } finally {
      await fsp.rm(tmp2, { recursive: true, force: true });
    }
  });
});
