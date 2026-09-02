import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createPathClassIndex } from "./path-class-index.js";

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
