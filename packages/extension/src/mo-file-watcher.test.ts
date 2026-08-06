import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

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
import { ClassInvalidationRegistry } from "./invalidation.js";
import { createSelfWriteGuard } from "./self-write-guard.js";
import { publishSourceChanges } from "./source-invalidation.js";
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
  notifySourceChanged: ReturnType<typeof vi.fn>;
} {
  const client = {
    parseFile: vi.fn(async () => ({ classNames: ["My.Pkg.Bar"] })),
    loadFile: vi.fn(async () => ({ success: true })),
    deleteClass: vi.fn(async () => ({ success: true })),
  };
  const childrenChanged = vi.fn();
  const notifySourceChanged = vi.fn();
  const deps: MoWatcherDeps = {
    ensureClient: async () => client,
    libraryTree: { childrenChanged },
    sourceProvider: { notifySourceChanged },
    guard: createSelfWriteGuard(),
    index: createPathClassIndex(),
    readFile: async () => "model Bar end Bar;",
    fileExists: async () => true,
    isBusy: () => false,
    ...overrides,
  };
  return { deps, client, childrenChanged, notifySourceChanged };
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

  it("loads a foreign edit and refreshes the class's scope and source", async () => {
    const { deps, client, childrenChanged, notifySourceChanged } = makeDeps();

    await handleMoChange(deps, FILE);

    expect(client.loadFile).toHaveBeenCalledWith({ fileName: FILE });
    expect(childrenChanged).toHaveBeenCalledWith("My.Pkg");
    expect(childrenChanged).toHaveBeenCalledWith("My.Pkg.Bar");
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
    const { deps, client, childrenChanged, notifySourceChanged } = makeDeps();
    deps.index.set(FILE, ["Top.A", "Top.B"]);
    client.parseFile.mockResolvedValue({ classNames: ["Top.A"] });

    await handleMoChange(deps, FILE);

    expect(client.deleteClass).toHaveBeenCalledWith({ typeName: "Top.B" });
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
  it("reorders the owning package by reloading it, then re-lists it", async () => {
    const { deps, client, childrenChanged, notifySourceChanged } = makeDeps({
      readFile: async () => "B\nA\n",
    });
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderChange(deps, ORDER_FILE);

    // A reload re-derives the child order from `package.order`, so nothing is
    // unloaded first — see `package-order-reload.integration.test.ts`.
    expect(client.loadFile).toHaveBeenCalledWith({ fileName: PKG_FILE });
    expect(client.deleteClass).not.toHaveBeenCalled();
    expect(childrenChanged).toHaveBeenCalledWith("My.Pkg");
    expect(childrenChanged).toHaveBeenCalledWith("My");
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

  it("no-ops when the owning package.mo isn't indexed", async () => {
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

  it("still re-lists and warns when the reload throws, not just when it reports failure", async () => {
    // A wedged channel or a timeout must not leave the tree unrefreshed and
    // the user untold — `success: false` was handled; a rejection was not.
    const { deps, client, childrenChanged } = makeDeps({
      readFile: async () => "B\nA\n",
      fileExists: async () => true,
    });
    client.loadFile.mockRejectedValue(new Error("omc channel timed out"));
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderChange(deps, ORDER_FILE);

    expect(childrenChanged).toHaveBeenCalledWith("My.Pkg");
    expect(recordedMessages).toContainEqual(
      expect.objectContaining({ level: "warning" }),
    );
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

  it("still re-lists but suppresses the out-of-sync warning when package.mo vanished mid-reorder", async () => {
    // A directory delete racing this reorder: the class was already deleted,
    // the reload against the now-gone file fails, but this is a delete, not
    // a broken reorder — handleMoDelete/handleOrderDelete own it instead.
    const { deps, client, childrenChanged } = makeDeps({
      readFile: async () => "A\nB\n",
      fileExists: async () => false,
    });
    client.loadFile.mockResolvedValue({ success: false });
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderChange(deps, ORDER_FILE);

    expect(childrenChanged).toHaveBeenCalledWith("My.Pkg");
    expect(recordedMessages).toHaveLength(0);
  });
});

describe("handleOrderDelete", () => {
  it("reloads the owning package back to its default order", async () => {
    const { deps, client, childrenChanged } = makeDeps();
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderDelete(deps, ORDER_FILE);

    expect(client.loadFile).toHaveBeenCalledWith({ fileName: PKG_FILE });
    expect(client.deleteClass).not.toHaveBeenCalled();
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
    const { deps, client } = makeDeps({ fileExists: async () => false });
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

/**
 * The watcher announces a class through `notifySourceChanged`, whose broadcast
 * is what {@link publishSourceChanges} turns into one invalidation. Wiring the
 * real chain — rather than counting the watcher's own calls — is what pins the
 * count: a second route into the sidebar shows up here and nowhere else.
 */
describe("class invalidation from a `.mo` change", () => {
  function wireInvalidation() {
    const broadcast = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    const invalidation = new ClassInvalidationRegistry();
    publishSourceChanges({ onDidChangeFile: broadcast.event }, invalidation);
    const libraryTree = { childrenChanged: vi.fn(), iconChanged: vi.fn() };
    invalidation.register((className) => libraryTree.iconChanged(className));
    // Mirrors `ModelicaSourceProvider.notifySourceChanged(typeName)`: a
    // `Changed` event on the class's source URI, for a removed class as much
    // as a kept one. The counts below are only as faithful as that match.
    const sourceProvider = {
      notifySourceChanged: (typeName?: string): void => {
        if (typeName === undefined) return;
        broadcast.fire([
          {
            type: vscode.FileChangeType.Changed,
            uri: sourceUriFor(typeName),
          },
        ]);
      },
    };
    return { libraryTree, sourceProvider };
  }

  it("invalidates each changed class's icon exactly once", async () => {
    const { libraryTree, sourceProvider } = wireInvalidation();
    const { deps, client } = makeDeps({ libraryTree, sourceProvider });
    client.parseFile.mockResolvedValue({
      classNames: ["My.Pkg.Bar", "My.Pkg.Baz"],
    });

    await handleMoChange(deps, FILE);

    expect(libraryTree.iconChanged.mock.calls).toEqual([
      ["My.Pkg.Bar"],
      ["My.Pkg.Baz"],
    ]);
  });

  it("announces a class the file no longer declares, ahead of the ones it keeps", async () => {
    // A removed class is announced too: its cached icon and restriction must
    // not survive to be served to a class of the same name loaded later.
    const { libraryTree, sourceProvider } = wireInvalidation();
    const { deps, client } = makeDeps({ libraryTree, sourceProvider });
    deps.index.set(FILE, ["My.Pkg.Bar", "My.Pkg.Gone"]);
    client.parseFile.mockResolvedValue({ classNames: ["My.Pkg.Bar"] });

    await handleMoChange(deps, FILE);

    expect(libraryTree.iconChanged.mock.calls).toEqual([
      ["My.Pkg.Gone"],
      ["My.Pkg.Bar"],
    ]);
  });

  it("invalidates each reordered package's icon exactly once", async () => {
    const { libraryTree, sourceProvider } = wireInvalidation();
    const { deps } = makeDeps({
      libraryTree,
      sourceProvider,
      readFile: async () => "B\nA\n",
    });
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderChange(deps, ORDER_FILE);

    expect(libraryTree.iconChanged.mock.calls).toEqual([["My.Pkg"]]);
  });
});
