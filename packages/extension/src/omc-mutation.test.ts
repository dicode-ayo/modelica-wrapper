import { describe, expect, it, vi } from "vitest";

import { applyOmcMutation } from "./omc-mutation.js";

function spies() {
  return { notifySourceChanged: vi.fn(), allClassesChanged: vi.fn() };
}

const emptyIndex = { get: () => undefined };

describe("applyOmcMutation", () => {
  it("refreshes a class-scoped mutation by name", () => {
    const seen = spies();

    applyOmcMutation(
      {
        fn: "setElementModifierValue",
        scope: { kind: "class", className: "Demo.Circuit" },
      },
      seen,
      seen,
      emptyIndex,
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
      seen,
      seen,
      index,
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
      seen,
      seen,
      emptyIndex,
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
        seen,
        seen,
        emptyIndex,
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
      unresolvable,
      unresolvable,
      emptyIndex,
    );
    // An indexed file that declares nothing means the index is behind, not
    // that the load changed nothing.
    applyOmcMutation(
      { fn: "loadString", scope: { kind: "file", fileName: "/w/Empty.mo" } },
      behindTheIndex,
      behindTheIndex,
      { get: () => [] },
    );

    expect(unresolvable.allClassesChanged).toHaveBeenCalledOnce();
    expect(behindTheIndex.allClassesChanged).toHaveBeenCalledOnce();
  });

  it("refreshes every open document alongside the coarse signal", () => {
    const seen = spies();

    applyOmcMutation(
      { fn: "renameClass", scope: { kind: "coarse" } },
      seen,
      seen,
      emptyIndex,
    );

    // Argument-less: the coarse signal drops the caches, but only the
    // provider reloads a buffer, and no class name is available to aim it.
    expect(seen.notifySourceChanged).toHaveBeenCalledExactlyOnceWith();
    expect(seen.allClassesChanged).toHaveBeenCalledOnce();
  });
});
