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
  alignOwnSourceToSharedFile,
  alignToSharedFile,
  bufferOwnCoords,
  keepForBuffer,
  type SharedFileClient,
} from "./shared-file-diagnostics.js";

const PACKAGE_MO = "/ws/P/package.mo";
const PACKAGE_SOURCE = "package P\n  model A\n    Real x;\n  end A;\nend P;";
const BUFFER_TEXT = "model A\n  Real x;\nend A;";
const INPUT = { typeName: "P.A", filename: PACKAGE_MO, text: BUFFER_TEXT };

type Extent = {
  lineNumberStart: number;
  lineNumberEnd: number;
  columnNumberStart: number;
};

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
    id: 1,
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

/**
 * Reports the class in its buffer once — enough to get past the pre-reload
 * guard — then hands every later read to `after`, which stands in for OMC
 * losing the class between the reload and the extent read.
 */
function readsThenFails(after: () => Extent) {
  let reads = 0;
  return vi.fn(async () => {
    reads += 1;
    return reads > 1
      ? after()
      : { lineNumberStart: 1, lineNumberEnd: 3, columnNumberStart: 1 };
  });
}

describe("alignToSharedFile", () => {
  it("reports the line and column shift the file's coordinates impose", async () => {
    const client = makeClient();

    const coords = await alignToSharedFile(client, INPUT);

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
      await alignToSharedFile(client, { ...INPUT, filename: "/ws/P/A.mo" }),
    ).toBeUndefined();
    expect(client.listFile).not.toHaveBeenCalled();
    expect(client.loadString).not.toHaveBeenCalled();
  });

  it("refuses to load an empty listing over the file", async () => {
    const client = makeClient({
      listFile: vi.fn(async () => ({ contents: "  \n" })),
    });

    expect(await alignToSharedFile(client, INPUT)).toBeUndefined();
    // Loading it would drop the file's classes from OMC, not renumber them.
    expect(client.loadString).not.toHaveBeenCalled();
  });

  it("gives up when the reload fails", async () => {
    const client = makeClient({
      loadString: vi.fn(async () => ({ success: false })),
    });

    expect(await alignToSharedFile(client, INPUT)).toBeUndefined();
  });

  it("gives up on an extent OMC cannot mean", async () => {
    const client = makeClient({
      getClassInformation: vi.fn(async () => ({
        lineNumberStart: 0,
        lineNumberEnd: 0,
        columnNumberStart: 0,
      })),
    });

    expect(await alignToSharedFile(client, INPUT)).toBeUndefined();
    expect(client.loadString).not.toHaveBeenCalled();
  });

  it("puts the buffer back when the reload lands but the extent does not", async () => {
    // Leaving the file's numbering in place while the caller reads positions
    // as the buffer's would drop the class's own diagnostics and admit its
    // siblings' — worse than not aligning at all.
    const client = makeClient({
      getClassInformation: readsThenFails(() => ({
        lineNumberStart: 0,
        lineNumberEnd: 0,
        columnNumberStart: 0,
      })),
    });

    expect(await alignToSharedFile(client, INPUT)).toBeUndefined();
    expect(client.loadString).toHaveBeenLastCalledWith({
      data: BUFFER_TEXT,
      filename: PACKAGE_MO,
      merge: false,
    });
  });

  it("puts the buffer back when the extent read throws", async () => {
    const client = makeClient({
      getClassInformation: readsThenFails(() => {
        throw new Error("class gone");
      }),
    });

    await expect(alignToSharedFile(client, INPUT)).rejects.toThrow(
      "class gone",
    );
    expect(client.loadString).toHaveBeenLastCalledWith({
      data: BUFFER_TEXT,
      filename: PACKAGE_MO,
      merge: false,
    });
  });
});

describe("alignOwnSourceToSharedFile", () => {
  it("skips the reload entirely for a class that owns its file", async () => {
    const client = makeClient({
      getSourceFile: vi.fn(async ({ typeName }: { typeName: string }) => ({
        fileName: typeName === "P.A" ? "/ws/P/A.mo" : PACKAGE_MO,
      })),
    });

    const coords = await alignOwnSourceToSharedFile(client, {
      typeName: "P.A",
      filename: "/ws/P/A.mo",
    });

    expect(coords).toBeUndefined();
    expect(client.listFile).not.toHaveBeenCalled();
    expect(client.loadString).not.toHaveBeenCalled();
  });

  it("loads the class's own listing and reports the shift when it shares the file", async () => {
    const client = makeClient({
      listFile: vi.fn(async ({ typeName }: { typeName: string }) => ({
        contents: typeName === "P.A" ? BUFFER_TEXT : PACKAGE_SOURCE,
      })),
    });

    const coords = await alignOwnSourceToSharedFile(client, {
      typeName: "P.A",
      filename: PACKAGE_MO,
    });

    expect(coords).toEqual({
      firstLine: 2,
      lastLine: 4,
      lineShift: 1,
      columnShift: 2,
    });
  });

  it("reads OMC's own coordinates when the reload lands but the alignment declines to map", async () => {
    // The standalone reload succeeds — OMC is left holding the buffer's own
    // coordinates, per `alignToSharedFile`'s contract — but the subsequent
    // file-wide reload can't place the class in it (an extent OMC cannot
    // mean, per `alignToSharedFile`'s own "gives up on an extent" case). That
    // is a known, well-defined state, not an unknown one: fall back to the
    // buffer's own coordinates rather than the nothing-in-bounds sentinel.
    const client = makeClient({
      listFile: vi.fn(async ({ typeName }: { typeName: string }) => ({
        contents: typeName === "P.A" ? BUFFER_TEXT : PACKAGE_SOURCE,
      })),
      getClassInformation: readsThenFails(() => ({
        lineNumberStart: 0,
        lineNumberEnd: 0,
        columnNumberStart: 0,
      })),
    });

    const coords = await alignOwnSourceToSharedFile(client, {
      typeName: "P.A",
      filename: PACKAGE_MO,
    });

    expect(coords).toEqual(bufferOwnCoords(BUFFER_TEXT.split("\n").length));
  });

  it("fails closed (bounds nothing in) rather than leaking unbounded when the reload reports failure", async () => {
    const client = makeClient({
      loadString: vi.fn(async () => ({ success: false })),
    });

    const coords = await alignOwnSourceToSharedFile(client, {
      typeName: "P.A",
      filename: PACKAGE_MO,
    });

    expect(coords).toEqual({
      firstLine: 1,
      lastLine: 0,
      lineShift: 0,
      columnShift: 0,
    });
    // Bounding to firstLine > lastLine excludes every located message.
    expect(
      keepForBuffer(
        [messageAt(PACKAGE_MO, 1)],
        PACKAGE_MO,
        coords ?? bufferOwnCoords(0),
      ),
    ).toEqual([]);
  });

  it("fails closed when the client throws", async () => {
    const client = makeClient({
      listFile: vi.fn(async () => {
        throw new Error("omc gone");
      }),
    });

    const coords = await alignOwnSourceToSharedFile(client, {
      typeName: "P.A",
      filename: PACKAGE_MO,
    });

    expect(coords).toEqual({
      firstLine: 1,
      lastLine: 0,
      lineShift: 0,
      columnShift: 0,
    });
  });

  it("propagates rather than swallows a throw from alignToSharedFile itself", async () => {
    // Unlike a failure in this function's own reload (above), a throw from
    // `alignToSharedFile` after the standalone reload has already landed
    // means OMC has already been restored to the buffer's own coordinates —
    // a known-good state, not an unknown one. Swallowing it into
    // NOTHING_IN_BOUNDS would discard diagnostics OMC can still place
    // correctly; propagating lets the caller decide (`runCheckModel` aborts
    // the whole check with an error, rather than silently reporting zero
    // squiggles for a class whose location is actually known).
    const client = makeClient({
      listFile: vi.fn(async ({ typeName }: { typeName: string }) => ({
        contents: typeName === "P.A" ? BUFFER_TEXT : PACKAGE_SOURCE,
      })),
      getClassInformation: readsThenFails(() => {
        throw new Error("class gone");
      }),
    });

    await expect(
      alignOwnSourceToSharedFile(client, {
        typeName: "P.A",
        filename: PACKAGE_MO,
      }),
    ).rejects.toThrow("class gone");
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
