/**
 * Unit tests for writing a class OMC already holds back to a source tree.
 *
 * A real temp directory and an in-memory client stub: the stub answers the
 * five lookups a save makes, and `listFile` returns whatever text a class was
 * seeded with, the way OMC's unparser would.
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveClass, type SaveClient } from "./save-class.js";
import type { SourceTree } from "./persist.js";

interface SeededClass {
  fileName: string;
  restriction: string;
  contents: string;
  members: string[];
}

interface Stub {
  client: SaveClient;
  writes: Array<{ fsPath: string; text: string }>;
  seed(typeName: string, seeded: Partial<SeededClass>): void;
}

function makeStub(): Stub {
  const classes = new Map<string, SeededClass>();
  const writes: Stub["writes"] = [];
  const look = (typeName: string): SeededClass => {
    const seeded = classes.get(typeName);
    if (seeded === undefined) throw new Error(`unknown class ${typeName}`);
    return seeded;
  };
  const client: SaveClient = {
    getClassInformation: async ({ typeName }) => look(typeName),
    getSourceFile: async ({ typeName }) => ({
      fileName: look(typeName).fileName,
    }),
    getClassNames: async ({ typeName }) => ({
      classNames: look(typeName).members,
    }),
    listFile: async ({ typeName }) => ({ contents: look(typeName).contents }),
    setSourceFile: async ({ typeName, fileName }) => {
      look(typeName).fileName = fileName;
      return { success: true };
    },
  };
  return {
    client,
    writes,
    seed: (typeName, seeded) =>
      classes.set(typeName, {
        fileName: `<runtime:${typeName}>`,
        restriction: "model",
        contents: `model ${typeName}\nend ${typeName};`,
        members: [],
        ...seeded,
      }),
  };
}

let root: string;
let stub: Stub;
let tree: SourceTree;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "save-class-"));
  stub = makeStub();
  tree = {
    root,
    writer: {
      write: async (fsPath, text) => {
        stub.writes.push({ fsPath, text });
        await fsp.mkdir(path.dirname(fsPath), { recursive: true });
        await fsp.writeFile(fsPath, text, "utf8");
      },
    },
  };
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

const read = (...segments: string[]): Promise<string> =>
  fsp.readFile(path.join(root, ...segments), "utf8");

describe("saveClass", () => {
  it("gives a class OMC holds in memory a file, and points OMC at it", async () => {
    // Every edit after a class is created leaves it here, bound to a
    // `<runtime:…>` placeholder that `save` would write out literally.
    stub.seed("Demo", { restriction: "package", members: ["RLC"] });
    stub.seed("Demo.RLC", {
      contents: "within Demo;\nmodel RLC\n  Real v;\nend RLC;",
    });

    const { saved } = await saveClass(stub.client, tree, "Demo.RLC");

    expect(saved).toEqual([
      { className: "Demo.RLC", fileName: path.join(root, "Demo", "RLC.mo") },
    ]);
    expect(await read("Demo", "RLC.mo")).toBe(
      "within Demo;\nmodel RLC\n  Real v;\nend RLC;\n",
    );
    expect(await read("Demo", "package.order")).toBe("RLC\n");
    const { fileName } = await stub.client.getSourceFile({
      typeName: "Demo.RLC",
    });
    expect(fileName).toBe(path.join(root, "Demo", "RLC.mo"));
  });

  it("writes the whole file when the class shares it with siblings", async () => {
    // `listFile` of an inline member returns that member alone. Writing it
    // over the shared file would drop every class declared beside it.
    const shared = path.join(root, "Inline.mo");
    stub.seed("Inline", {
      fileName: shared,
      restriction: "package",
      members: ["A", "B"],
      contents:
        "package Inline\n  model A\n  end A;\n  model B\n  end B;\nend Inline;",
    });
    stub.seed("Inline.A", { fileName: shared, contents: "model A\nend A;" });
    stub.seed("Inline.B", { fileName: shared, contents: "model B\nend B;" });

    const { saved } = await saveClass(stub.client, tree, "Inline.A");

    expect(saved).toEqual([{ className: "Inline", fileName: shared }]);
    expect(await read("Inline.mo")).toContain("model B");
  });

  it("saves a package's members and writes no member twice", async () => {
    // `save` on a package writes its package.mo and stops. A member with its
    // own file, and one OMC holds in memory, are both missed — and a member
    // declared inline was already written by the package itself.
    const pkgFile = path.join(root, "Demo", "package.mo");
    const ownFile = path.join(root, "Demo", "Own.mo");
    stub.seed("Demo", {
      fileName: pkgFile,
      restriction: "package",
      members: ["Inline", "Own", "Fresh"],
      contents: "package Demo\n  model Inline\n  end Inline;\nend Demo;",
    });
    stub.seed("Demo.Inline", { fileName: pkgFile });
    stub.seed("Demo.Own", {
      fileName: ownFile,
      contents: "model Own\nend Own;",
    });
    stub.seed("Demo.Fresh", { contents: "model Fresh\nend Fresh;" });

    const { saved } = await saveClass(stub.client, tree, "Demo");

    expect(saved).toEqual([
      { className: "Demo", fileName: pkgFile },
      { className: "Demo.Own", fileName: ownFile },
      {
        className: "Demo.Fresh",
        fileName: path.join(root, "Demo", "Fresh.mo"),
      },
    ]);
    expect(stub.writes.filter((w) => w.fsPath === pkgFile)).toHaveLength(1);
  });

  it("says so when the file it wrote is one nothing names", async () => {
    // A single-file package declares its members inline and has no
    // package.order, so a member given a file of its own is unreachable from
    // the package — written, and still lost to anything that loads it.
    const shared = path.join(root, "Single.mo");
    stub.seed("Single", {
      fileName: shared,
      restriction: "package",
      members: ["Fresh"],
      contents: "package Single\nend Single;",
    });
    stub.seed("Single.Fresh", { contents: "model Fresh\nend Fresh;" });

    const { saved, warnings } = await saveClass(stub.client, tree, "Single");

    expect(saved.map((s) => s.className)).toEqual(["Single", "Single.Fresh"]);
    expect(warnings).toEqual([expect.stringContaining("single file")]);
  });

  it("leaves a member the caller may not write alone, and says which", async () => {
    // A package reaches members nobody named. Judging only the class the
    // caller asked for would write a member's file on a verdict that never
    // saw it — skipping writes nothing, so nothing lands half-done.
    const pkgFile = path.join(root, "Demo", "package.mo");
    const ownFile = path.join(root, "Demo", "Own.mo");
    stub.seed("Demo", {
      fileName: pkgFile,
      restriction: "package",
      members: ["Own", "Locked"],
      contents: "package Demo\nend Demo;",
    });
    stub.seed("Demo.Own", {
      fileName: ownFile,
      contents: "model Own\nend Own;",
    });
    stub.seed("Demo.Locked", { fileName: path.join(root, "Locked.mo") });

    const { saved, skipped } = await saveClass(stub.client, tree, "Demo", {
      authorize: async (className) =>
        className === "Demo.Locked" ? "Locked belongs elsewhere." : undefined,
    });

    expect(saved.map((s) => s.className)).toEqual(["Demo", "Demo.Own"]);
    expect(skipped).toEqual([
      { className: "Demo.Locked", reason: "Locked belongs elsewhere." },
    ]);
    expect(stub.writes.map((w) => w.fsPath)).not.toContain(
      path.join(root, "Locked.mo"),
    );
  });

  it("refuses to write a listing OMC returned empty", async () => {
    // A transient OMC failure lists nothing for a real class. Writing that
    // truncates the file, taking every class in it.
    const file = path.join(root, "Demo.mo");
    await fsp.writeFile(file, "model Demo\nend Demo;\n", "utf8");
    stub.seed("Demo", { fileName: file, contents: "   " });

    await expect(saveClass(stub.client, tree, "Demo")).rejects.toThrow(
      /listed no source/,
    );
    expect(await read("Demo.mo")).toBe("model Demo\nend Demo;\n");
  });

  it("ends the file with a newline OMC's unparser leaves off", async () => {
    const file = path.join(root, "Demo.mo");
    stub.seed("Demo", { fileName: file, contents: "model Demo\nend Demo;" });

    await saveClass(stub.client, tree, "Demo");

    expect(await read("Demo.mo")).toBe("model Demo\nend Demo;\n");
  });
});
