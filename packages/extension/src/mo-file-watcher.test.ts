import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordedMessages,
  resetTabs,
  setTabGroups,
  TabInputCustom,
  TabInputText,
  Uri,
} from "../test-support/vscode-mock.js";

import {
  createPathClassIndex,
  handleMoChange,
  handleMoDelete,
  handleOrderChange,
  handleOrderDelete,
  isDeclaredClassBusy,
  seedPathClassIndex,
  type MoWatcherDeps,
} from "./mo-file-watcher.js";
import { createSelfWriteGuard } from "./self-write-guard.js";
import { sourceUriFor } from "./source-provider.js";

const FILE = "/ws/My/Pkg/Bar.mo";

function makeDeps(overrides: Partial<MoWatcherDeps> = {}): {
  deps: MoWatcherDeps;
  client: {
    parseFile: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
    deleteClass: ReturnType<typeof vi.fn>;
  };
  childrenChanged: ReturnType<typeof vi.fn>;
  iconChanged: ReturnType<typeof vi.fn>;
  notifySourceChanged: ReturnType<typeof vi.fn>;
} {
  const client = {
    parseFile: vi.fn(async () => ({ classNames: ["My.Pkg.Bar"] })),
    loadFile: vi.fn(async () => ({ success: true })),
    deleteClass: vi.fn(async () => ({ success: true })),
  };
  const childrenChanged = vi.fn();
  const iconChanged = vi.fn();
  const notifySourceChanged = vi.fn();
  const deps: MoWatcherDeps = {
    ensureClient: async () => client,
    libraryTree: { childrenChanged, iconChanged },
    sourceProvider: { notifySourceChanged },
    guard: createSelfWriteGuard(),
    index: createPathClassIndex(),
    readFile: async () => "model Bar end Bar;",
    isBusy: () => false,
    ...overrides,
  };
  return { deps, client, childrenChanged, iconChanged, notifySourceChanged };
}

beforeEach(() => {
  recordedMessages.length = 0;
  resetTabs();
});

describe("handleMoChange", () => {
  it("ignores our own write matched by content through the guard", async () => {
    const guard = createSelfWriteGuard();
    guard.record(FILE, "model Bar end Bar;");
    const { deps, client, childrenChanged } = makeDeps({ guard });

    await handleMoChange(deps, FILE);

    expect(client.parseFile).not.toHaveBeenCalled();
    expect(client.loadFile).not.toHaveBeenCalled();
    expect(childrenChanged).not.toHaveBeenCalled();
  });

  it("loads a foreign edit and refreshes the class's scope and icon", async () => {
    const { deps, client, childrenChanged, iconChanged, notifySourceChanged } =
      makeDeps();

    await handleMoChange(deps, FILE);

    expect(client.loadFile).toHaveBeenCalledWith({ fileName: FILE });
    expect(childrenChanged).toHaveBeenCalledWith("My.Pkg");
    expect(childrenChanged).toHaveBeenCalledWith("My.Pkg.Bar");
    expect(iconChanged).toHaveBeenCalledWith("My.Pkg.Bar");
    expect(notifySourceChanged).toHaveBeenCalledWith("My.Pkg.Bar");
    expect(deps.index.get(FILE)).toEqual(["My.Pkg.Bar"]);
  });

  it("re-lists the root for a top-level class", async () => {
    const { deps, client, childrenChanged } = makeDeps();
    client.parseFile.mockResolvedValue({ classNames: ["Top"] });

    await handleMoChange(deps, FILE);

    expect(childrenChanged).toHaveBeenCalledWith(null);
    expect(childrenChanged).toHaveBeenCalledWith("Top");
  });

  it("unloads a class the file no longer declares", async () => {
    const { deps, client, childrenChanged, iconChanged, notifySourceChanged } =
      makeDeps();
    deps.index.set(FILE, ["Top.A", "Top.B"]);
    client.parseFile.mockResolvedValue({ classNames: ["Top.A"] });

    await handleMoChange(deps, FILE);

    expect(client.deleteClass).toHaveBeenCalledWith({ typeName: "Top.B" });
    expect(iconChanged).not.toHaveBeenCalledWith("Top.B");
    expect(childrenChanged).toHaveBeenCalledWith("Top");
    // The removed class's open source doc must be invalidated too.
    expect(notifySourceChanged).toHaveBeenCalledWith("Top.B");
    expect(deps.index.get(FILE)).toEqual(["Top.A"]);
  });

  it("skips a reload that would clobber an unsaved buffer, and warns", async () => {
    const { deps, client, childrenChanged } = makeDeps({ isBusy: () => true });

    await handleMoChange(deps, FILE);

    expect(client.loadFile).not.toHaveBeenCalled();
    expect(childrenChanged).not.toHaveBeenCalled();
    expect(recordedMessages).toContainEqual(
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("does not touch the tree when loadFile fails", async () => {
    const { deps, client, childrenChanged } = makeDeps();
    client.loadFile.mockResolvedValue({ success: false });

    await handleMoChange(deps, FILE);

    expect(childrenChanged).not.toHaveBeenCalled();
    expect(deps.index.get(FILE)).toBeUndefined();
  });

  it("bails when the file cannot be read", async () => {
    const { deps, client } = makeDeps({
      readFile: async () => {
        throw new Error("ENOENT");
      },
    });

    await handleMoChange(deps, FILE);

    expect(client.parseFile).not.toHaveBeenCalled();
  });
});

describe("handleMoDelete", () => {
  it("unloads the deleted file's indexed classes and re-lists their scope", async () => {
    const { deps, client, childrenChanged, notifySourceChanged } = makeDeps();
    deps.index.set(FILE, ["My.Pkg.Bar"]);

    await handleMoDelete(deps, FILE);

    expect(client.deleteClass).toHaveBeenCalledWith({ typeName: "My.Pkg.Bar" });
    expect(childrenChanged).toHaveBeenCalledWith("My.Pkg");
    expect(notifySourceChanged).toHaveBeenCalledWith("My.Pkg.Bar");
    expect(deps.index.get(FILE)).toBeUndefined();
  });

  it("no-ops a delete for a path it never indexed", async () => {
    const { deps, client, childrenChanged } = makeDeps();

    await handleMoDelete(deps, FILE);

    expect(client.deleteClass).not.toHaveBeenCalled();
    expect(childrenChanged).not.toHaveBeenCalled();
  });

  it("defers a delete while a declared class is open and dirty", async () => {
    const { deps, client } = makeDeps({ isBusy: () => true });
    deps.index.set(FILE, ["My.Pkg.Bar"]);

    await handleMoDelete(deps, FILE);

    expect(client.deleteClass).not.toHaveBeenCalled();
    expect(recordedMessages).toContainEqual(
      expect.objectContaining({ level: "warning" }),
    );
  });
});

const PKG_FILE = "/ws/My/Pkg/package.mo";
const ORDER_FILE = "/ws/My/Pkg/package.order";

describe("handleOrderChange", () => {
  it("reorders the owning package via delete + reload, then re-lists it", async () => {
    const { deps, client, childrenChanged, iconChanged, notifySourceChanged } =
      makeDeps({ readFile: async () => "B\nA\n" });
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderChange(deps, ORDER_FILE);

    // Reordering must go through delete + reload: `loadFile` alone merges
    // into the existing symbol table (per `handleMoChange`'s own removed-class
    // handling) and would not re-derive the child order on its own.
    expect(client.deleteClass).toHaveBeenCalledWith({ typeName: "My.Pkg" });
    expect(client.loadFile).toHaveBeenCalledWith({ fileName: PKG_FILE });
    const [deletedAt] = client.deleteClass.mock.invocationCallOrder;
    const [loadedAt] = client.loadFile.mock.invocationCallOrder;
    if (deletedAt === undefined || loadedAt === undefined) {
      throw new Error("expected both deleteClass and loadFile to be called");
    }
    expect(deletedAt).toBeLessThan(loadedAt);
    expect(childrenChanged).toHaveBeenCalledWith("My.Pkg");
    expect(childrenChanged).toHaveBeenCalledWith("My");
    expect(iconChanged).toHaveBeenCalledWith("My.Pkg");
    expect(notifySourceChanged).toHaveBeenCalledWith("My.Pkg");
  });

  it("ignores our own package.order write matched by content through the guard", async () => {
    const guard = createSelfWriteGuard();
    guard.record(ORDER_FILE, "A\nB\n");
    const { deps, client } = makeDeps({
      guard,
      readFile: async () => "A\nB\n",
    });
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderChange(deps, ORDER_FILE);

    expect(client.deleteClass).not.toHaveBeenCalled();
    expect(client.loadFile).not.toHaveBeenCalled();
  });

  it("warns when the owning package.mo isn't indexed", async () => {
    const { deps, client } = makeDeps({ readFile: async () => "A\n" });

    await handleOrderChange(deps, ORDER_FILE);

    expect(client.deleteClass).not.toHaveBeenCalled();
    expect(client.loadFile).not.toHaveBeenCalled();
  });

  it("skips a reorder that would clobber an unsaved buffer, and names package.order in the warning", async () => {
    const { deps, client, childrenChanged } = makeDeps({
      readFile: async () => "A\nB\n",
      isBusy: () => true,
    });
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderChange(deps, ORDER_FILE);

    expect(client.loadFile).not.toHaveBeenCalled();
    expect(childrenChanged).not.toHaveBeenCalled();
    // The triggering edit was to package.order, not package.mo — the warning
    // must name the file the user actually touched.
    expect(recordedMessages).toContainEqual(
      expect.objectContaining({
        level: "warning",
        message: expect.stringContaining("package.order"),
      }),
    );
  });

  it("treats a busy nested member as busy too, since deleteClass cascades to the whole subtree", async () => {
    const seenNames: string[][] = [];
    const { deps, client } = makeDeps({
      readFile: async () => "A\nB\n",
      isBusy: (_fsPath, classNames) => {
        seenNames.push(classNames);
        return classNames.includes("My.Pkg.Bar");
      },
    });
    deps.index.set(PKG_FILE, ["My.Pkg"]);
    deps.index.set("/ws/My/Pkg/Bar.mo", ["My.Pkg.Bar"]);

    await handleOrderChange(deps, ORDER_FILE);

    expect(client.deleteClass).not.toHaveBeenCalled();
    expect(seenNames[0]).toEqual(
      expect.arrayContaining(["My.Pkg", "My.Pkg.Bar"]),
    );
  });

  it("bails when package.order can't be read", async () => {
    const { deps, client } = makeDeps({
      readFile: async () => {
        throw new Error("ENOENT");
      },
    });
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderChange(deps, ORDER_FILE);

    expect(client.deleteClass).not.toHaveBeenCalled();
  });

  it("still re-lists the tree and warns when the reload fails, so the tree reflects OMC's real state", async () => {
    const { deps, client, childrenChanged } = makeDeps({
      readFile: async () => "A\nB\n",
    });
    client.loadFile.mockResolvedValue({ success: false });
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderChange(deps, ORDER_FILE);

    // The class was already deleted before the failed reload — re-listing
    // pulls whatever OMC now actually holds instead of a stale, deleted view.
    expect(childrenChanged).toHaveBeenCalledWith("My.Pkg");
    expect(recordedMessages).toContainEqual(
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("re-lists but warns when a deleteClass call is refused, instead of silently reporting success", async () => {
    const { deps, client, childrenChanged } = makeDeps({
      readFile: async () => "A\nB\n",
    });
    client.deleteClass.mockResolvedValue({ success: false });
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderChange(deps, ORDER_FILE);

    expect(client.loadFile).toHaveBeenCalledWith({ fileName: PKG_FILE });
    expect(childrenChanged).toHaveBeenCalledWith("My.Pkg");
    expect(recordedMessages).toContainEqual(
      expect.objectContaining({ level: "warning" }),
    );
  });
});

describe("handleOrderDelete", () => {
  it("reorders the owning package back to its default order", async () => {
    const { deps, client, childrenChanged } = makeDeps();
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderDelete(deps, ORDER_FILE);

    expect(client.deleteClass).toHaveBeenCalledWith({ typeName: "My.Pkg" });
    expect(client.loadFile).toHaveBeenCalledWith({ fileName: PKG_FILE });
    expect(childrenChanged).toHaveBeenCalledWith("My.Pkg");
  });

  it("defers while a declared class is open and dirty", async () => {
    const { deps, client } = makeDeps({ isBusy: () => true });
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderDelete(deps, ORDER_FILE);

    expect(client.loadFile).not.toHaveBeenCalled();
    expect(recordedMessages).toContainEqual(
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("no-ops silently when the owning package.mo is gone too — a whole-directory delete, not a reorder", async () => {
    const { deps, client } = makeDeps({
      readFile: async () => {
        throw new Error("ENOENT");
      },
    });
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderDelete(deps, ORDER_FILE);

    expect(client.deleteClass).not.toHaveBeenCalled();
    expect(client.loadFile).not.toHaveBeenCalled();
    expect(recordedMessages).toHaveLength(0);
  });
});

describe("isDeclaredClassBusy", () => {
  it("is true for a dirty custom editor over the class source", () => {
    setTabGroups([
      {
        viewColumn: 1,
        tabs: [
          {
            input: new TabInputCustom(
              sourceUriFor("My.Pkg.Bar"),
              "modelica.diagram",
            ),
            isDirty: true,
          },
        ],
      },
    ]);
    expect(isDeclaredClassBusy(FILE, ["My.Pkg.Bar"])).toBe(true);
  });

  it("is true for a dirty text editor over the file on disk", () => {
    setTabGroups([
      {
        viewColumn: 1,
        tabs: [{ input: new TabInputText(Uri.file(FILE)), isDirty: true }],
      },
    ]);
    expect(isDeclaredClassBusy(FILE, ["My.Pkg.Bar"])).toBe(true);
  });

  it("is false when the matching tab is clean", () => {
    setTabGroups([
      {
        viewColumn: 1,
        tabs: [
          {
            input: new TabInputCustom(
              sourceUriFor("My.Pkg.Bar"),
              "modelica.diagram",
            ),
            isDirty: false,
          },
        ],
      },
    ]);
    expect(isDeclaredClassBusy(FILE, ["My.Pkg.Bar"])).toBe(false);
  });
});

describe("seedPathClassIndex", () => {
  it("indexes each parseable file and skips failures", async () => {
    const index = createPathClassIndex();
    const client = {
      parseFile: vi.fn(async ({ fileName }: { fileName: string }) => {
        if (fileName === "/ws/Bad.mo") throw new Error("parse error");
        return { classNames: ["Ok"] };
      }),
    };

    await seedPathClassIndex(client, ["/ws/Ok.mo", "/ws/Bad.mo"], index);

    expect(index.get("/ws/Ok.mo")).toEqual(["Ok"]);
    expect(index.get("/ws/Bad.mo")).toBeUndefined();
  });
});

describe("createPathClassIndex", () => {
  it("normalizes paths so a differently-spelled lookup still resolves", () => {
    const index = createPathClassIndex();
    index.set("/ws/pkg/Bar.mo", ["Bar"]);
    expect(index.get("/ws/pkg/../pkg/Bar.mo")).toEqual(["Bar"]);
  });

  describe("classesUnder", () => {
    it("includes the package itself and every class nested under it", () => {
      const index = createPathClassIndex();
      index.set("/ws/My/Pkg/package.mo", ["My.Pkg"]);
      index.set("/ws/My/Pkg/Bar.mo", ["My.Pkg.Bar"]);
      index.set("/ws/My/Other.mo", ["My.Other"]);

      expect(index.classesUnder("My.Pkg")).toEqual(
        expect.arrayContaining(["My.Pkg", "My.Pkg.Bar"]),
      );
      expect(index.classesUnder("My.Pkg")).not.toContain("My.Other");
    });

    it("doesn't treat a same-prefixed sibling as nested", () => {
      const index = createPathClassIndex();
      index.set("/ws/My/Pkg.mo", ["My.Pkg"]);
      index.set("/ws/My/PkgTwo.mo", ["My.PkgTwo"]);

      expect(index.classesUnder("My.Pkg")).toEqual(["My.Pkg"]);
    });
  });
});
