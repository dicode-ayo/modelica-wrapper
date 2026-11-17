import { describe, expect, it, vi } from "vitest";

import { applyOmcMutation } from "./omc-mutation.js";

function spies(open: readonly string[] = []) {
  return {
    notifySourceChanged: vi.fn(),
    openClassNames: () => open,
    allClassesChanged: vi.fn(),
    childrenChanged: vi.fn(),
  };
}

const emptyIndex = { get: () => undefined };

/** `seen` standing in for every target, behind `index`. */
function targets(
  seen: ReturnType<typeof spies>,
  index: { get(fsPath: string): string[] | undefined } = emptyIndex,
) {
  return { source: seen, invalidation: seen, libraryTree: seen, index };
}

describe("applyOmcMutation", () => {
  it("refreshes a class-scoped mutation by name", () => {
    const seen = spies();

    applyOmcMutation(
      {
        fn: "setElementModifierValue",
        scope: { kind: "class", className: "Demo.Circuit" },
      },
      targets(seen),
    );

    expect(seen.notifySourceChanged).toHaveBeenCalledExactlyOnceWith(
      "Demo.Circuit",
    );
    expect(seen.allClassesChanged).not.toHaveBeenCalled();
  });

  it("refreshes every class an indexed file declares", () => {
    const seen = spies();
    const index = { get: () => ["Demo", "Demo.Circuit"] };

    applyOmcMutation(
      {
        fn: "loadString",
        scope: { kind: "file", fileName: "/w/Demo/package.mo" },
      },
      targets(seen, index),
    );

    expect(seen.notifySourceChanged.mock.calls).toEqual([
      ["Demo"],
      ["Demo.Circuit"],
    ]);
    expect(seen.allClassesChanged).not.toHaveBeenCalled();
  });

  it("reads the class straight off a memory-only class's buffer URI", () => {
    const seen = spies();

    applyOmcMutation(
      {
        fn: "loadString",
        scope: { kind: "file", fileName: "modelica-source:/Demo.Circuit.mo" },
      },
      targets(seen),
    );

    expect(seen.notifySourceChanged).toHaveBeenCalledExactlyOnceWith(
      "Demo.Circuit",
    );
  });

  it("goes coarse for a modelica-source URI carrying no class name", () => {
    // An empty name is not a class. Announcing it would reach
    // `notifySourceChanged("")`, whose falsy check quietly downgrades it to
    // "refresh the open documents" and drops the caches on the floor.
    for (const fileName of [
      "modelica-source:",
      "modelica-source:/",
      "modelica-source:/.mo",
    ]) {
      const seen = spies();

      applyOmcMutation(
        { fn: "loadString", scope: { kind: "file", fileName } },
        targets(seen),
      );

      expect(seen.allClassesChanged).toHaveBeenCalledOnce();
      expect(seen.notifySourceChanged).toHaveBeenCalledExactlyOnceWith();
    }
  });

  it("goes coarse for a file nothing can resolve to a class", () => {
    const unresolvable = spies();
    const behindTheIndex = spies();

    applyOmcMutation(
      {
        fn: "loadString",
        scope: { kind: "file", fileName: "<runtime:Demo.New>" },
      },
      targets(unresolvable),
    );
    // An indexed file that declares nothing means the index is behind, not
    // that the load changed nothing.
    applyOmcMutation(
      { fn: "loadString", scope: { kind: "file", fileName: "/w/Empty.mo" } },
      targets(behindTheIndex, { get: () => [] }),
    );

    expect(unresolvable.allClassesChanged).toHaveBeenCalledOnce();
    expect(behindTheIndex.allClassesChanged).toHaveBeenCalledOnce();
  });

  it("refreshes every open document alongside the coarse signal", () => {
    const seen = spies();

    applyOmcMutation(
      { fn: "renameClass", scope: { kind: "coarse" } },
      targets(seen),
    );

    // Argument-less: the coarse signal drops the caches, but only the
    // provider reloads a buffer, and no class name is available to aim it.
    expect(seen.notifySourceChanged).toHaveBeenCalledExactlyOnceWith();
    expect(seen.allClassesChanged).toHaveBeenCalledOnce();
  });
});

describe("applyOmcMutation on a member-list change", () => {
  const created = {
    fn: "newModel",
    scope: { kind: "members", parent: "Demo.Sub" },
  } as const;
  const deleted = {
    fn: "deleteClass",
    scope: { kind: "members", parent: "Demo.Sub", removed: "Demo.Sub.A" },
  } as const;

  it("re-lists the parent in the library tree", () => {
    const seen = spies();

    applyOmcMutation(created, targets(seen));

    expect(seen.childrenChanged).toHaveBeenCalledExactlyOnceWith("Demo.Sub");
  });

  it("reloads the parent and every class enclosing it", () => {
    // `Demo` owning the file means its buffer holds `Demo.Sub`'s old member
    // list, and saving it would write the change back out.
    const seen = spies(["Demo", "Other"]);

    applyOmcMutation(created, targets(seen));

    expect(seen.notifySourceChanged.mock.calls).toEqual([
      ["Demo.Sub"],
      ["Demo"],
    ]);
  });

  it("leaves unrelated classes and caches alone when nothing was removed", () => {
    const seen = spies(["Other", "Demo.Sub.B"]);

    applyOmcMutation(created, targets(seen));

    expect(seen.notifySourceChanged).not.toHaveBeenCalledWith("Other");
    expect(seen.notifySourceChanged).not.toHaveBeenCalledWith("Demo.Sub.B");
    expect(seen.notifySourceChanged).not.toHaveBeenCalledWith();
    expect(seen.allClassesChanged).not.toHaveBeenCalled();
  });

  it("reloads every open buffer on the removed class or nested in it", () => {
    const seen = spies([
      "Demo.Sub.A",
      "Demo.Sub.A.Inner",
      "Demo.Sub.A.Inner.Deep",
      "Demo.Sub.AB",
      "Other",
    ]);

    applyOmcMutation(deleted, targets(seen));

    expect(seen.notifySourceChanged.mock.calls).toEqual([
      ["Demo.Sub"],
      ["Demo"],
      ["Demo.Sub.A"],
      ["Demo.Sub.A.Inner"],
      ["Demo.Sub.A.Inner.Deep"],
    ]);
  });

  it("drops every cache on a removal, since none can be asked for the keys under it", () => {
    const seen = spies();

    applyOmcMutation(deleted, targets(seen));

    expect(seen.allClassesChanged).toHaveBeenCalledOnce();
    expect(seen.childrenChanged).toHaveBeenCalledExactlyOnceWith("Demo.Sub");
  });

  it("matches a removed quoted identifier containing a dot by segment", () => {
    const seen = spies(["Demo.'a.b'.C", "Demo.'a.b.c'"]);

    applyOmcMutation(
      {
        fn: "deleteClass",
        scope: { kind: "members", parent: "Demo", removed: "Demo.'a.b'" },
      },
      targets(seen),
    );

    expect(seen.notifySourceChanged.mock.calls).toEqual([
      ["Demo"],
      ["Demo.'a.b'.C"],
    ]);
  });
});
