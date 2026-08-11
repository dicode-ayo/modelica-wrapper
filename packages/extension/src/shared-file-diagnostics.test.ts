/**
 * The two coordinate systems a shared `.mo` puts in play, and the mapping back
 * to the buffer. The OMC behaviour modelled here — a reloaded class reported
 * inside the string it was loaded from, its siblings still in the file — is
 * pinned against a live OMC in
 * `packages/omc-client/test/loadString-filename.integration.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";

import type { ErrorMessage } from "@dicode/omc-client";

import {
  alignToSharedFile,
  bufferOwnCoords,
  keepForBuffer,
  type SharedFileClient,
} from "./shared-file-diagnostics.js";

const PACKAGE_MO = "/ws/P/package.mo";
const PACKAGE_SOURCE = "package P\n  model A\n    Real x;\n  end A;\nend P;";

function messageAt(
  filename: string,
  lineStart: number,
  columnStart = 1,
  lineEnd = lineStart,
): ErrorMessage {
  return {
    info: {
      filename,
      readonly: false,
      lineStart,
      columnStart,
      lineEnd,
      columnEnd: columnStart + 4,
    },
    message: "boom",
    kind: "translation",
    level: "error",
  };
}

/**
 * `P.A` sits at lines 2-4, column 3 of `package.mo`, and at lines 1-3,
 * column 1 of its own buffer — the shift the mapping has to undo.
 */
function makeClient(overrides: Partial<SharedFileClient> = {}) {
  let renumbered = false;
  return {
    getSourceFile: vi.fn(async () => ({ fileName: PACKAGE_MO })),
    getClassInformation: vi.fn(async () =>
      renumbered
        ? { lineNumberStart: 2, lineNumberEnd: 4, columnNumberStart: 3 }
        : { lineNumberStart: 1, lineNumberEnd: 3, columnNumberStart: 1 },
    ),
    listFile: vi.fn(async () => ({ contents: PACKAGE_SOURCE })),
    loadString: vi.fn(async ({ data }: { data: string }) => {
      if (data === PACKAGE_SOURCE) renumbered = true;
      return { success: true };
    }),
    ...overrides,
  } satisfies SharedFileClient;
}

describe("alignToSharedFile", () => {
  it("reports the line and column shift the file's coordinates impose", async () => {
    const client = makeClient();

    const coords = await alignToSharedFile(client, "P.A", PACKAGE_MO);

    expect(coords).toEqual({
      firstLine: 2,
      lastLine: 4,
      lineShift: 1,
      columnShift: 2,
    });
  });

  it("leaves a class that owns its file alone", async () => {
    const client = makeClient({
      getSourceFile: vi.fn(async ({ typeName }: { typeName: string }) => ({
        fileName: typeName === "P.A" ? "/ws/P/A.mo" : PACKAGE_MO,
      })),
    });

    expect(
      await alignToSharedFile(client, "P.A", "/ws/P/A.mo"),
    ).toBeUndefined();
    expect(client.listFile).not.toHaveBeenCalled();
    expect(client.loadString).not.toHaveBeenCalled();
  });

  it("refuses to load an empty listing over the file", async () => {
    const client = makeClient({
      listFile: vi.fn(async () => ({ contents: "  \n" })),
    });

    expect(await alignToSharedFile(client, "P.A", PACKAGE_MO)).toBeUndefined();
    // Loading it would drop the file's classes from OMC, not renumber them.
    expect(client.loadString).not.toHaveBeenCalled();
  });

  it("gives up when the reload fails", async () => {
    const client = makeClient({
      loadString: vi.fn(async () => ({ success: false })),
    });

    expect(await alignToSharedFile(client, "P.A", PACKAGE_MO)).toBeUndefined();
  });

  it("gives up on an extent OMC cannot mean", async () => {
    const client = makeClient({
      getClassInformation: vi.fn(async () => ({
        lineNumberStart: 0,
        lineNumberEnd: 0,
        columnNumberStart: 0,
      })),
    });

    expect(await alignToSharedFile(client, "P.A", PACKAGE_MO)).toBeUndefined();
  });
});

describe("keepForBuffer", () => {
  const coords = {
    firstLine: 2,
    lastLine: 4,
    lineShift: 1,
    columnShift: 2,
  };

  it("shifts a message inside the class back onto the buffer", () => {
    const [kept] = keepForBuffer(
      [messageAt(PACKAGE_MO, 3, 5)],
      PACKAGE_MO,
      coords,
    );

    expect(kept?.info.lineStart).toBe(2);
    expect(kept?.info.columnStart).toBe(3);
    expect(kept?.info.columnEnd).toBe(7);
  });

  it("drops a sibling's message that falls on a line the buffer also has", () => {
    // Line 1 is `package P` — a real line of the file, and a real line of the
    // buffer, but not one of this class's.
    expect(
      keepForBuffer([messageAt(PACKAGE_MO, 1)], PACKAGE_MO, coords),
    ).toEqual([]);
    expect(
      keepForBuffer([messageAt(PACKAGE_MO, 5)], PACKAGE_MO, coords),
    ).toEqual([]);
  });

  it("clamps a message spanning past the class to its last line", () => {
    const [kept] = keepForBuffer(
      [messageAt(PACKAGE_MO, 3, 1, 9)],
      PACKAGE_MO,
      coords,
    );

    expect(kept?.info.lineEnd).toBe(3);
  });

  it("passes a message with no source location through unbounded", () => {
    // OMC reports `lineStart: 0` for a message it has no position for; the
    // resolver still routes it to the buffer.
    const noLocation = messageAt(PACKAGE_MO, 0, 0);

    expect(keepForBuffer([noLocation], PACKAGE_MO, coords)).toEqual([
      noLocation,
    ]);
  });

  it("passes a message against another file through untouched", () => {
    const elsewhere = messageAt("/ws/Other.mo", 99);

    expect(keepForBuffer([elsewhere], PACKAGE_MO, coords)).toEqual([elsewhere]);
  });

  it("bounds against the buffer's own size when nothing shares the file", () => {
    const coords = bufferOwnCoords(3);

    expect(
      keepForBuffer([messageAt(PACKAGE_MO, 3)], PACKAGE_MO, coords),
    ).toHaveLength(1);
    expect(
      keepForBuffer([messageAt(PACKAGE_MO, 4)], PACKAGE_MO, coords),
    ).toEqual([]);
  });
});
