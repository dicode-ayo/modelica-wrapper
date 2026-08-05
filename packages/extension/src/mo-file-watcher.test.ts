import * as path from "node:path";

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
  watcherRunKey,
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
    fileExists: async () => true,
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

  it("defers deleteClass-ing a removed package whose nested member — in a different file — is open dirty as plain text", async () => {
    const PARENT_FILE = "/ws/My/Parent.mo";
    const NESTED_FILE = "/ws/My/Pkg/Bar.mo";
    setTabGroups([
      {
        viewColumn: 1,
        tabs: [
          { input: new TabInputText(Uri.file(NESTED_FILE)), isDirty: true },
        ],
      },
    ]);
    const { deps, client } = makeDeps({ isBusy: isDeclaredClassBusy });
    client.parseFile.mockResolvedValue({ classNames: ["My.Kept"] });
    // PARENT_FILE used to also declare "My.Pkg" (now removed from source);
    // "My.Pkg" cascades deleteClass to "My.Pkg.Bar", declared in NESTED_FILE.
    deps.index.set(PARENT_FILE, ["My.Kept", "My.Pkg"]);
    deps.index.set(NESTED_FILE, ["My.Pkg.Bar"]);

    await handleMoChange(deps, PARENT_FILE);

    expect(client.loadFile).not.toHaveBeenCalled();
  });

  it("doesn't pass a removed class's own file and name twice to the busy check", async () => {
    // "My.Pkg" is both explicitly removed and, since the pre-update index
    // still lists it under FILE, rediscovered via its own cascade lookup —
    // the busy check's inputs must be deduplicated, not just its outcome.
    let seenFsPaths: string[] = [];
    let seenNames: string[] = [];
    const { deps, client } = makeDeps({
      isBusy: (fsPaths, classNames) => {
        seenFsPaths = fsPaths;
        seenNames = classNames;
        return false;
      },
    });
    client.parseFile.mockResolvedValue({ classNames: [] });
    deps.index.set(FILE, ["My.Pkg"]);

    await handleMoChange(deps, FILE);

    expect(seenFsPaths.filter((p) => p === FILE)).toHaveLength(1);
    expect(seenNames.filter((n) => n === "My.Pkg")).toHaveLength(1);
  });

  it("dedupes a removed class's file even when the triggering path isn't normalized", async () => {
    // filesUnder returns path.resolve()d keys; the triggering fsPath must be
    // resolved the same way before joining the set, or the same file reaches
    // the busy check twice under two different spellings of its own path.
    const UNNORMALIZED = "/ws/My/Pkg/../Pkg/Bar.mo";
    let seenFsPaths: string[] = [];
    const { deps, client } = makeDeps({
      isBusy: (fsPaths) => {
        seenFsPaths = fsPaths;
        return false;
      },
    });
    client.parseFile.mockResolvedValue({ classNames: [] });
    deps.index.set(UNNORMALIZED, ["My.Pkg.Bar"]);

    await handleMoChange(deps, UNNORMALIZED);

    // Exact-array equality, not a filtered count: an unresolved second entry
    // for the same file would leave the count at 1 too, since the filter
    // itself discards the very duplicate this test exists to catch.
    expect(seenFsPaths).toEqual([path.resolve(UNNORMALIZED)]);
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

  it("defers deleting a package whose nested member — in a different file — is open dirty as plain text", async () => {
    const PKG_FILE = "/ws/My/Pkg/package.mo";
    const BAR_FILE = "/ws/My/Pkg/Bar.mo";
    setTabGroups([
      {
        viewColumn: 1,
        tabs: [{ input: new TabInputText(Uri.file(BAR_FILE)), isDirty: true }],
      },
    ]);
    const { deps, client } = makeDeps({ isBusy: isDeclaredClassBusy });
    deps.index.set(PKG_FILE, ["My.Pkg"]);
    deps.index.set(BAR_FILE, ["My.Pkg.Bar"]);

    await handleMoDelete(deps, PKG_FILE);

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
    const { deps, client, childrenChanged, iconChanged, notifySourceChanged } =
      makeDeps({ readFile: async () => "B\nA\n" });
    deps.index.set(PKG_FILE, ["My.Pkg"]);

    await handleOrderChange(deps, ORDER_FILE);

    // A reload re-derives the child order from `package.order`, so nothing is
    // unloaded first — see `package-order-reload.integration.test.ts`.
    expect(client.loadFile).toHaveBeenCalledWith({ fileName: PKG_FILE });
    expect(client.deleteClass).not.toHaveBeenCalled();
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

  it("treats a busy nested member as busy too, since a reload cascades to the whole subtree", async () => {
    const seenFsPaths: string[][] = [];
    const seenNames: string[][] = [];
    const { deps, client } = makeDeps({
      readFile: async () => "A\nB\n",
      isBusy: (fsPaths, classNames) => {
        seenFsPaths.push(fsPaths);
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
    // The nested member's own file, not just the package's, has to be checked
    // for a dirty plain-text buffer — that file is what a reload would clobber.
    expect(seenFsPaths[0]).toEqual(
      expect.arrayContaining([PKG_FILE, "/ws/My/Pkg/Bar.mo"]),
    );
  });

  it("blocks a reorder when a nested member — not the package itself — is open dirty as plain text", async () => {
    const BAR_FILE = "/ws/My/Pkg/Bar.mo";
    setTabGroups([
      {
        viewColumn: 1,
        tabs: [{ input: new TabInputText(Uri.file(BAR_FILE)), isDirty: true }],
      },
    ]);
    const { deps, client, childrenChanged } = makeDeps({
      readFile: async () => "A\nB\n",
      isBusy: isDeclaredClassBusy,
    });
    deps.index.set(PKG_FILE, ["My.Pkg"]);
    deps.index.set(BAR_FILE, ["My.Pkg.Bar"]);

    await handleOrderChange(deps, ORDER_FILE);

    expect(client.loadFile).not.toHaveBeenCalled();
    expect(childrenChanged).not.toHaveBeenCalled();
    expect(recordedMessages).toContainEqual(
      expect.objectContaining({ level: "warning" }),
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
    expect(isDeclaredClassBusy([FILE], ["My.Pkg.Bar"])).toBe(true);
  });

  it("is true for a dirty text editor over the file on disk", () => {
    setTabGroups([
      {
        viewColumn: 1,
        tabs: [{ input: new TabInputText(Uri.file(FILE)), isDirty: true }],
      },
    ]);
    expect(isDeclaredClassBusy([FILE], ["My.Pkg.Bar"])).toBe(true);
  });

  it("is true for a dirty text editor over any file in a multi-file fsPaths list", () => {
    const OTHER_FILE = "/ws/My/Pkg/Other.mo";
    setTabGroups([
      {
        viewColumn: 1,
        tabs: [
          { input: new TabInputText(Uri.file(OTHER_FILE)), isDirty: true },
        ],
      },
    ]);
    expect(isDeclaredClassBusy([FILE, OTHER_FILE], ["My.Pkg.Bar"])).toBe(true);
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
    expect(isDeclaredClassBusy([FILE], ["My.Pkg.Bar"])).toBe(false);
  });
});

describe("watcherRunKey", () => {
  const MEMBER_FILE = "/ws/My/Pkg/Bar.mo";

  it("resolves a nested member's key to its owning package's file", () => {
    const index = createPathClassIndex();
    index.set(PKG_FILE, ["My.Pkg"]);
    index.set(MEMBER_FILE, ["My.Pkg.Bar"]);

    expect(watcherRunKey(index, MEMBER_FILE)).toBe(PKG_FILE);
  });

  it("keys a package.mo's own change event on itself, not its parent package", () => {
    // A member's key has to land on the *same* package.mo a package.order
    // event for that package resolves to via orderOwner — walking up the
    // qualified name from package.mo's own declared class ("My.Pkg") would
    // land one level too high, on "My"'s package.mo instead.
    const index = createPathClassIndex();
    index.set("/ws/My/package.mo", ["My"]);
    index.set(PKG_FILE, ["My.Pkg"]);
    index.set(MEMBER_FILE, ["My.Pkg.Bar"]);

    expect(watcherRunKey(index, PKG_FILE)).toBe(PKG_FILE);
  });

  it("falls back to the file's own path for a standalone file with no package.mo sibling", () => {
    const index = createPathClassIndex();
    index.set("/ws/Top.mo", ["Top"]);

    expect(watcherRunKey(index, "/ws/Top.mo")).toBe("/ws/Top.mo");
  });

  it("falls back to the file's own path when the file isn't indexed yet", () => {
    const index = createPathClassIndex();

    expect(watcherRunKey(index, "/ws/New.mo")).toBe("/ws/New.mo");
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

  describe("filesUnder", () => {
    it("pairs the package's own file and every nested member's file with just its matching classes", () => {
      const index = createPathClassIndex();
      index.set("/ws/My/Pkg/package.mo", ["My.Pkg"]);
      index.set("/ws/My/Pkg/Bar.mo", ["My.Pkg.Bar"]);
      index.set("/ws/My/Other.mo", ["My.Other"]);

      const found = index.filesUnder("My.Pkg");

      expect(found).toEqual(
        expect.arrayContaining([
          {
            fsPath: path.resolve("/ws/My/Pkg/package.mo"),
            classNames: ["My.Pkg"],
          },
          {
            fsPath: path.resolve("/ws/My/Pkg/Bar.mo"),
            classNames: ["My.Pkg.Bar"],
          },
        ]),
      );
      expect(found).not.toContainEqual(
        expect.objectContaining({ fsPath: path.resolve("/ws/My/Other.mo") }),
      );
    });

    it("doesn't treat a same-prefixed sibling as nested", () => {
      const index = createPathClassIndex();
      index.set("/ws/My/Pkg.mo", ["My.Pkg"]);
      index.set("/ws/My/PkgTwo.mo", ["My.PkgTwo"]);

      expect(index.filesUnder("My.Pkg")).toEqual([
        { fsPath: path.resolve("/ws/My/Pkg.mo"), classNames: ["My.Pkg"] },
      ]);
    });
  });
});
