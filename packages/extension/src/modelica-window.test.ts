import { describe, expect, it } from "vitest";

import { hasModelicaContent, type OpenDocument } from "./modelica-window.js";

function deps(
  openDocuments: OpenDocument[],
  moFiles: string[] = [],
): {
  openDocuments: () => readonly OpenDocument[];
  scanMoFiles: () => Promise<readonly string[]>;
  scans: number;
} {
  const state = {
    openDocuments: () => openDocuments,
    scanMoFiles: async () => {
      state.scans += 1;
      return moFiles;
    },
    scans: 0,
  };
  return state;
}

describe("hasModelicaContent", () => {
  it("is false for a window with nothing Modelica in it", async () => {
    const d = deps([{ languageId: "typescript", scheme: "file" }]);

    expect(await hasModelicaContent(d)).toBe(false);
  });

  it("counts a `.mo` file in the workspace the user has not opened", async () => {
    const d = deps([], ["/w/Circuit.mo"]);

    expect(await hasModelicaContent(d)).toBe(true);
  });

  it("counts a restored editor on a class no workspace file mentions", async () => {
    // A `modelica-source:` document is a listing OMC prints for a library
    // class, so the disk scan cannot see the reason this window has one.
    const d = deps([{ languageId: "plaintext", scheme: "modelica-source" }]);

    expect(await hasModelicaContent(d)).toBe(true);
    expect(d.scans).toBe(0);
  });

  it("answers from the open documents before it touches the disk", async () => {
    const d = deps([{ languageId: "modelica", scheme: "file" }], []);

    expect(await hasModelicaContent(d)).toBe(true);
    expect(d.scans).toBe(0);
  });
});
