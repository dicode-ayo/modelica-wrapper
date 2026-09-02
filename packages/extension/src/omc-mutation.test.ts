import { describe, expect, it, vi } from "vitest";

import { applyOmcMutation } from "./omc-mutation.js";

function spies() {
  return { classChanged: vi.fn(), allClassesChanged: vi.fn() };
}

const emptyIndex = { get: () => undefined };

describe("applyOmcMutation", () => {
  it("announces a class-scoped mutation by name", () => {
    const invalidation = spies();

    applyOmcMutation(
      {
        fn: "setElementModifierValue",
        scope: { kind: "class", className: "Demo.Circuit" },
      },
      invalidation,
      emptyIndex,
    );

    expect(invalidation.classChanged).toHaveBeenCalledExactlyOnceWith(
      "Demo.Circuit",
    );
    expect(invalidation.allClassesChanged).not.toHaveBeenCalled();
  });

  it("announces every class an indexed file declares", () => {
    const invalidation = spies();
    const index = { get: () => ["Demo", "Demo.Circuit"] };

    applyOmcMutation(
      {
        fn: "loadString",
        scope: { kind: "file", fileName: "/w/Demo/package.mo" },
      },
      invalidation,
      index,
    );

    expect(invalidation.classChanged.mock.calls).toEqual([
      ["Demo"],
      ["Demo.Circuit"],
    ]);
    expect(invalidation.allClassesChanged).not.toHaveBeenCalled();
  });

  it("reads the class straight off a memory-only class's buffer URI", () => {
    const invalidation = spies();

    applyOmcMutation(
      {
        fn: "loadString",
        scope: { kind: "file", fileName: "modelica-source:/Demo.Circuit.mo" },
      },
      invalidation,
      emptyIndex,
    );

    expect(invalidation.classChanged).toHaveBeenCalledExactlyOnceWith(
      "Demo.Circuit",
    );
  });

  it("goes coarse for a file no index and no URI can name", () => {
    const invalidation = spies();

    applyOmcMutation(
      {
        fn: "loadString",
        scope: { kind: "file", fileName: "<runtime:Demo.New>" },
      },
      invalidation,
      emptyIndex,
    );

    expect(invalidation.allClassesChanged).toHaveBeenCalledOnce();
    expect(invalidation.classChanged).not.toHaveBeenCalled();
  });

  it("goes coarse for an indexed file that declares nothing, since the index is behind", () => {
    const invalidation = spies();

    applyOmcMutation(
      { fn: "loadString", scope: { kind: "file", fileName: "/w/Empty.mo" } },
      invalidation,
      { get: () => [] },
    );

    expect(invalidation.allClassesChanged).toHaveBeenCalledOnce();
  });

  it("passes a coarse mutation straight through", () => {
    const invalidation = spies();

    applyOmcMutation(
      { fn: "renameClass", scope: { kind: "coarse" } },
      invalidation,
      emptyIndex,
    );

    expect(invalidation.allClassesChanged).toHaveBeenCalledOnce();
    expect(invalidation.classChanged).not.toHaveBeenCalled();
  });
});
