/**
 * Unit tests for the on-disk class-persistence helpers.
 *
 * Uses a real temp directory + an in-memory `OmcClient` stub. The stub
 * implements the three methods the persist helpers call —
 * `getClassInformation`, `setSourceFile`, and `getClassNames` — which is
 * enough to exercise every branch (existing on-disk parent, in-memory parent,
 * missing parent, existing package.mo/package.order not overwritten, etc.).
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OmcClient } from "@dicode/omc-client";

import {
  isLikelyDiskPath,
  linkPersistedClass,
  persistClassUnderWorkspace,
} from "./persist.js";
import { createSelfWriteGuard } from "./self-write-guard.js";

describe("isLikelyDiskPath", () => {
  it("rejects empty + pseudo paths, accepts real paths", () => {
    // Pseudo-paths OMC emits when a class came from loadString.
    expect(isLikelyDiskPath("")).toBe(false);
    expect(isLikelyDiskPath("<runtime:TempModel>")).toBe(false);
    expect(isLikelyDiskPath("<interactive>")).toBe(false);
    expect(isLikelyDiskPath("modelica-source:/Foo.mo")).toBe(false);
    expect(isLikelyDiskPath("file:/tmp/Foo.mo")).toBe(false);
    expect(isLikelyDiskPath("https://example.com/Foo.mo")).toBe(false);

    // Real disk paths — unix, relative, and Windows drive letters all pass.
    expect(isLikelyDiskPath("/tmp/Foo.mo")).toBe(true);
    expect(isLikelyDiskPath("./Foo.mo")).toBe(true);
    expect(isLikelyDiskPath("Foo.mo")).toBe(true);
    expect(isLikelyDiskPath("C:\\Users\\me\\Foo.mo")).toBe(true);
    expect(isLikelyDiskPath("C:/Users/me/Foo.mo")).toBe(true);
  });
});

/**
 * Stub `OmcClient` that only implements the methods the persist helpers
 * touch. `classes` seeds `getClassInformation` results; `children` seeds
 * `getClassNames` results; `setSourceFile` calls are captured in `setCalls`.
 */
interface Stub {
  client: OmcClient;
  setCalls: Array<{ typeName: string; fileName: string }>;
  seedClass(typeName: string, fileName: string): void;
  seedChildren(typeName: string, names: string[]): void;
}

function makeClientStub(): Stub {
  const classes = new Map<string, string>();
  const children = new Map<string, string[]>();
  const setCalls: Stub["setCalls"] = [];
  const client = {
    async getClassInformation({ typeName }: { typeName: string }) {
      const fileName = classes.get(typeName);
      if (fileName === undefined) {
        throw new Error(`unknown class ${typeName}`);
      }
      return baseClassInfo(fileName);
    },
    async setSourceFile({
      typeName,
      fileName,
    }: {
      typeName: string;
      fileName: string;
    }) {
      setCalls.push({ typeName, fileName });
      classes.set(typeName, fileName);
      return { success: true };
    },
    async getClassNames({ typeName }: { typeName: string }) {
      const names = children.get(typeName);
      if (names === undefined) throw new Error(`unknown class ${typeName}`);
      return { classNames: names };
    },
  } as unknown as OmcClient;
  return {
    client,
    setCalls,
    seedClass: (typeName, fileName) => classes.set(typeName, fileName),
    seedChildren: (typeName, names) => children.set(typeName, names),
  };
}

function baseClassInfo(fileName: string) {
  return {
    restriction: "model",
    comment: "",
    partialPrefix: false,
    finalPrefix: false,
    encapsulatedPrefix: false,
    fileName,
    fileReadOnly: false,
    lineNumberStart: 1,
    columnNumberStart: 1,
    lineNumberEnd: 1,
    columnNumberEnd: 1,
    dimensions: [],
    isProtectedClass: false,
    isDocumentationClass: false,
    version: "",
    preferredView: "",
    state: false,
    access: "",
    versionDate: "",
    versionBuild: "",
    dateModified: "",
    revisionId: "",
  };
}

describe("persistClassUnderWorkspace", () => {
  let tmp: string;
  const guard = createSelfWriteGuard();
  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "persist-test-"));
  });
  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("flat class: writes <root>/<Name>.mo with no parents", async () => {
    const { client } = makeClientStub();
    const result = await persistClassUnderWorkspace(
      client,
      tmp,
      "TempModel",
      "model TempModel\nend TempModel;\n",
      guard,
    );
    expect(result.leafPath).toBe(path.join(tmp, "TempModel.mo"));
    expect(result.newParents).toEqual([]);
    const text = await fsp.readFile(result.leafPath, "utf8");
    expect(text).toBe("model TempModel\nend TempModel;\n");
  });

  it("nested class: creates package.mo at each missing level with correct `within`", async () => {
    const { client } = makeClientStub();
    // None of the parents are known to OMC, so all three levels get fresh
    // <dir>/package.mo files under the workspace root.
    const result = await persistClassUnderWorkspace(
      client,
      tmp,
      "MyLib.Sub.Model",
      "block Model\nend Model;\n",
      guard,
    );
    expect(result.leafPath).toBe(path.join(tmp, "MyLib", "Sub", "Model.mo"));
    expect(result.newParents).toEqual([
      { typeName: "MyLib", pkgFile: path.join(tmp, "MyLib", "package.mo") },
      {
        typeName: "MyLib.Sub",
        pkgFile: path.join(tmp, "MyLib", "Sub", "package.mo"),
      },
    ]);
    expect(await fsp.readFile(result.leafPath, "utf8")).toBe(
      "block Model\nend Model;\n",
    );
    // Top-level package — no `within` header.
    expect(
      await fsp.readFile(path.join(tmp, "MyLib", "package.mo"), "utf8"),
    ).toBe("package MyLib\nend MyLib;\n");
    // Mid-level package — `within MyLib;`.
    expect(
      await fsp.readFile(path.join(tmp, "MyLib", "Sub", "package.mo"), "utf8"),
    ).toBe("within MyLib;\npackage Sub\nend Sub;\n");
  });

  it("does not overwrite an existing on-disk package.mo", async () => {
    const { client } = makeClientStub();
    const myLibDir = path.join(tmp, "MyLib");
    await fsp.mkdir(myLibDir, { recursive: true });
    const original = "// hand-edited package\npackage MyLib\nend MyLib;\n";
    await fsp.writeFile(path.join(myLibDir, "package.mo"), original, "utf8");

    await persistClassUnderWorkspace(
      client,
      tmp,
      "MyLib.Model",
      "model Model\nend Model;\n",
      guard,
    );
    // Still still our hand-edited content — persist must not clobber.
    expect(await fsp.readFile(path.join(myLibDir, "package.mo"), "utf8")).toBe(
      original,
    );
  });

  it("uses an existing on-disk parent's directory when OMC reports one", async () => {
    const { client, seedClass } = makeClientStub();
    // Pretend MyLib already lives at a hand-picked location outside `tmp`.
    const externalDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ext-lib-"));
    const externalPkg = path.join(externalDir, "package.mo");
    await fsp.writeFile(externalPkg, "package MyLib\nend MyLib;\n", "utf8");
    seedClass("MyLib", externalPkg);

    const result = await persistClassUnderWorkspace(
      client,
      tmp,
      "MyLib.Model",
      "model Model\nend Model;\n",
      guard,
    );
    // Leaf lands inside MyLib's existing directory, NOT under tmp.
    expect(result.leafPath).toBe(path.join(externalDir, "Model.mo"));
    // No new parents — MyLib was already on disk.
    expect(result.newParents).toEqual([]);
    // tmp should be empty of any MyLib folder.
    const tmpEntries = await fsp.readdir(tmp);
    expect(tmpEntries).not.toContain("MyLib");

    await fsp.rm(externalDir, { recursive: true, force: true });
  });

  it("treats pseudo-paths on parents as in-memory", async () => {
    // A common reality: createClass loadString'd MyLib with the
    // `<runtime:MyLib>` pseudo filename. persist must NOT treat that as a
    // disk path and try to dirname() it — instead, create MyLib under root.
    const { client, seedClass } = makeClientStub();
    seedClass("MyLib", "<runtime:MyLib>");
    const result = await persistClassUnderWorkspace(
      client,
      tmp,
      "MyLib.Model",
      "model Model\nend Model;\n",
      guard,
    );
    expect(result.leafPath).toBe(path.join(tmp, "MyLib", "Model.mo"));
    expect(result.newParents).toEqual([
      { typeName: "MyLib", pkgFile: path.join(tmp, "MyLib", "package.mo") },
    ]);
  });

  it("writes package.order listing OMC children alongside each new package.mo", async () => {
    const { client, seedChildren } = makeClientStub();
    seedChildren("MyLib", ["Sub"]);
    seedChildren("MyLib.Sub", ["Model"]);
    await persistClassUnderWorkspace(
      client,
      tmp,
      "MyLib.Sub.Model",
      "block Model\nend Model;\n",
      guard,
    );
    expect(
      await fsp.readFile(path.join(tmp, "MyLib", "package.order"), "utf8"),
    ).toBe("Sub\n");
    expect(
      await fsp.readFile(
        path.join(tmp, "MyLib", "Sub", "package.order"),
        "utf8",
      ),
    ).toBe("Model\n");
  });

  it("tags a new package.order write through the guard, like the package.mo beside it", async () => {
    // A watcher reacting to this same write (mo-file-watcher.ts) must be able
    // to tell it apart from a user's own package.order edit; the guard is
    // what makes that possible.
    const { client, seedChildren } = makeClientStub();
    seedChildren("MyLib", ["Model"]);
    await persistClassUnderWorkspace(
      client,
      tmp,
      "MyLib.Model",
      "model Model\nend Model;\n",
      guard,
    );
    const orderFile = path.join(tmp, "MyLib", "package.order");
    const diskText = await fsp.readFile(orderFile, "utf8");
    expect(guard.claim(orderFile, diskText)).toBe(true);
  });

  it("tags the leaf package's own package.order write through the guard too", async () => {
    const { client, seedChildren } = makeClientStub();
    seedChildren("MyPkg", ["Model"]);
    await persistClassUnderWorkspace(
      client,
      tmp,
      "MyPkg",
      "package MyPkg\nend MyPkg;\n",
      guard,
      "package",
    );
    const orderFile = path.join(tmp, "MyPkg", "package.order");
    const diskText = await fsp.readFile(orderFile, "utf8");
    expect(guard.claim(orderFile, diskText)).toBe(true);
  });

  it("still writes package.order with just the leaf segment when getClassNames returns empty", async () => {
    const { client, seedChildren } = makeClientStub();
    seedChildren("MyLib", []);
    await persistClassUnderWorkspace(
      client,
      tmp,
      "MyLib.Model",
      "model Model\nend Model;\n",
      guard,
    );
    expect(
      await fsp.readFile(path.join(tmp, "MyLib", "package.order"), "utf8"),
    ).toBe("Model\n");
  });

  it("does not overwrite an existing package.order", async () => {
    const { client, seedChildren } = makeClientStub();
    seedChildren("MyLib", ["Model", "Other"]);
    const myLibDir = path.join(tmp, "MyLib");
    await fsp.mkdir(myLibDir, { recursive: true });
    const original = "Other\nModel\n";
    await fsp.writeFile(path.join(myLibDir, "package.order"), original, "utf8");
    await persistClassUnderWorkspace(
      client,
      tmp,
      "MyLib.Model",
      "model Model\nend Model;\n",
      guard,
    );
    expect(
      await fsp.readFile(path.join(myLibDir, "package.order"), "utf8"),
    ).toBe(original);
  });

  it("still writes package.order with just the leaf segment when getClassNames throws", async () => {
    const { client } = makeClientStub();
    // No seedChildren call → getClassNames will throw for MyLib, but
    // the leaf segment is always included unconditionally.
    await persistClassUnderWorkspace(
      client,
      tmp,
      "MyLib.Model",
      "model Model\nend Model;\n",
      guard,
    );
    expect(
      await fsp.readFile(path.join(tmp, "MyLib", "package.order"), "utf8"),
    ).toBe("Model\n");
  });

  it("includes the leaf segment in package.order even when OMC child list omits it", async () => {
    const { client, seedChildren } = makeClientStub();
    // OMC doesn't list Model yet (e.g. createClass hasn't called setSourceFile).
    seedChildren("MyLib", []);
    await persistClassUnderWorkspace(
      client,
      tmp,
      "MyLib.Model",
      "model Model\nend Model;\n",
      guard,
    );
    expect(
      await fsp.readFile(path.join(tmp, "MyLib", "package.order"), "utf8"),
    ).toBe("Model\n");
  });

  it("filters invalid identifiers from getClassNames before writing package.order", async () => {
    const { client, seedChildren } = makeClientStub();
    // A class name with an embedded newline would corrupt the file format.
    seedChildren("MyLib", ["Valid", "bad\nname", "", "Also_Valid"]);
    await persistClassUnderWorkspace(
      client,
      tmp,
      "MyLib.Model",
      "model Model\nend Model;\n",
      guard,
    );
    expect(
      await fsp.readFile(path.join(tmp, "MyLib", "package.order"), "utf8"),
    ).toBe("Valid\nAlso_Valid\nModel\n");
  });

  it("package leaf: writes <Name>/package.mo, not <Name>.mo", async () => {
    const { client } = makeClientStub();
    const result = await persistClassUnderWorkspace(
      client,
      tmp,
      "MyPkg",
      "package MyPkg\nend MyPkg;\n",
      guard,
      "package",
    );
    expect(result.leafPath).toBe(path.join(tmp, "MyPkg", "package.mo"));
    expect(result.newParents).toEqual([]);
    expect(await fsp.readFile(result.leafPath, "utf8")).toBe(
      "package MyPkg\nend MyPkg;\n",
    );
    // The flat .mo file must NOT be written.
    await expect(fsp.access(path.join(tmp, "MyPkg.mo"))).rejects.toThrow();
  });

  it("package leaf nested: writes <parent>/<Name>/package.mo", async () => {
    const { client } = makeClientStub();
    const result = await persistClassUnderWorkspace(
      client,
      tmp,
      "MyLib.SubPkg",
      "within MyLib;\npackage SubPkg\nend SubPkg;\n",
      guard,
      "package",
    );
    expect(result.leafPath).toBe(
      path.join(tmp, "MyLib", "SubPkg", "package.mo"),
    );
    expect(await fsp.readFile(result.leafPath, "utf8")).toBe(
      "within MyLib;\npackage SubPkg\nend SubPkg;\n",
    );
    // Flat SubPkg.mo must NOT be written.
    await expect(
      fsp.access(path.join(tmp, "MyLib", "SubPkg.mo")),
    ).rejects.toThrow();
  });

  it("package leaf: setSourceFile gets package.mo path, enabling child nesting", async () => {
    const { client, setCalls } = makeClientStub();
    const result = await persistClassUnderWorkspace(
      client,
      tmp,
      "MyPkg",
      "package MyPkg\nend MyPkg;\n",
      guard,
      "package",
    );
    await linkPersistedClass(client, "MyPkg", result);
    // OMC is told about the package.mo file, not the directory.
    expect(setCalls).toEqual([
      { typeName: "MyPkg", fileName: path.join(tmp, "MyPkg", "package.mo") },
    ]);
  });

  it("package leaf: onDiskParentDir resolves to package directory for children", async () => {
    const { client, seedClass, seedChildren } = makeClientStub();
    seedClass("MyPkg", path.join(tmp, "MyPkg", "package.mo"));
    seedChildren("MyPkg", []);
    await fsp.mkdir(path.join(tmp, "MyPkg"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "MyPkg", "package.mo"),
      "package MyPkg\nend MyPkg;\n",
      "utf8",
    );

    const result = await persistClassUnderWorkspace(
      client,
      tmp,
      "MyPkg.Child",
      "within MyPkg;\nmodel Child\nend Child;\n",
      guard,
    );
    expect(result.leafPath).toBe(path.join(tmp, "MyPkg", "Child.mo"));
    expect(result.newParents).toEqual([]);
  });
});

describe("linkPersistedClass", () => {
  it("calls setSourceFile for each new parent then the leaf", async () => {
    const { client, setCalls } = makeClientStub();
    await linkPersistedClass(client, "MyLib.Sub.Model", {
      leafPath: "/ws/MyLib/Sub/Model.mo",
      newParents: [
        { typeName: "MyLib", pkgFile: "/ws/MyLib/package.mo" },
        { typeName: "MyLib.Sub", pkgFile: "/ws/MyLib/Sub/package.mo" },
      ],
    });
    // Order matters: parents go first so OMC sees the package files before
    // the member class. This ordering is part of the contract.
    expect(setCalls).toEqual([
      { typeName: "MyLib", fileName: "/ws/MyLib/package.mo" },
      { typeName: "MyLib.Sub", fileName: "/ws/MyLib/Sub/package.mo" },
      { typeName: "MyLib.Sub.Model", fileName: "/ws/MyLib/Sub/Model.mo" },
    ]);
  });

  it("only sets the leaf when there are no new parents", async () => {
    const { client, setCalls } = makeClientStub();
    await linkPersistedClass(client, "TempModel", {
      leafPath: "/ws/TempModel.mo",
      newParents: [],
    });
    expect(setCalls).toEqual([
      { typeName: "TempModel", fileName: "/ws/TempModel.mo" },
    ]);
  });
});
