/**
 * Maps OMC's diagnostics for a class stored inline in a shared `.mo` back onto
 * the buffer being edited.
 *
 * `loadString` renumbers only what it loads. After a buffer is reloaded under
 * its package's real path, OMC reports the reloaded class's positions relative
 * to that string, while its siblings keep the positions they hold in the file.
 * The two coordinate spaces overlap, and `ErrorMessage.info` names a filename
 * rather than the class it belongs to, so a sibling's diagnostic can carry a
 * line that is also a valid line of the buffer.
 *
 * Reloading the whole file puts every class in one coordinate space, where the
 * edited class's extent and its siblings' are disjoint by construction.
 */

import type { ErrorMessage } from "@dicode/omc-client";

import { hasNoSourceLocation } from "./diagnostics/from-omc.js";
import { fileOwnerClass, type FileOwnerClient } from "./file-owner.js";
import { log } from "./logger.js";

export interface SharedFileClient extends FileOwnerClient {
  getClassInformation(input: { typeName: string }): Promise<{
    lineNumberStart: number;
    lineNumberEnd: number;
    columnNumberStart: number;
  }>;
  listFile(input: { typeName: string }): Promise<{ contents: string }>;
  loadString(input: {
    data: string;
    filename: string;
    merge: boolean;
  }): Promise<{ success: boolean }>;
}

/**
 * The window of OMC-reported positions that belong to the edited buffer, and
 * the offsets that carry one back into the buffer's own coordinates.
 *
 * Line bounds are inclusive and 1-based, matching `ErrorMessage.info`.
 */
export interface BufferCoords {
  firstLine: number;
  lastLine: number;
  lineShift: number;
  columnShift: number;
}

/** The identity mapping: OMC's positions are already the buffer's. */
export function bufferOwnCoords(lineCount: number): BufferCoords {
  return { firstLine: 1, lastLine: lineCount, lineShift: 0, columnShift: 0 };
}

/**
 * Renumber `filename`'s classes into the file's own coordinate space and return
 * the mapping from it back to the buffer, or `undefined` when `typeName` owns
 * its file outright — nothing shares it, so OMC's positions are the buffer's.
 *
 * Reads the class's extent before and after the reload: the pretty-printer
 * indents a member by its nesting depth, so the file's coordinates differ from
 * the buffer's in column as well as line.
 *
 * Whether it returns a mapping, returns `undefined`, or throws, OMC is left
 * holding coordinates the caller can name: the file's on success, the buffer's
 * otherwise — reloading `text` to get back there when the file reload already
 * landed.
 */
export async function alignToSharedFile(
  client: SharedFileClient,
  input: { typeName: string; filename: string; text: string },
): Promise<BufferCoords | undefined> {
  const { typeName, filename, text } = input;
  const owner = await fileOwnerClass(client, typeName);
  if (owner === typeName) return undefined;

  const inBuffer = await client.getClassInformation({ typeName });
  if (inBuffer.lineNumberStart < 1 || inBuffer.columnNumberStart < 1) {
    log.warn("sharedFile", `OMC places ${typeName} nowhere in its buffer`);
    return undefined;
  }

  const { contents } = await client.listFile({ typeName: owner });
  // Loading an empty listing would drop the file's classes from OMC rather
  // than renumber them.
  if (contents.trim() === "") {
    log.warn("sharedFile", `listFile(${owner}) came back empty`);
    return undefined;
  }
  const { success } = await client.loadString({
    data: contents,
    filename,
    merge: false,
  });
  if (!success) {
    log.warn("sharedFile", `reloading ${filename} failed`);
    return undefined;
  }

  let inFile;
  try {
    inFile = await client.getClassInformation({ typeName });
  } catch (err) {
    await restoreBuffer(client, filename, text);
    throw err;
  }
  if (
    inFile.lineNumberStart < 1 ||
    inFile.lineNumberEnd < inFile.lineNumberStart ||
    inFile.columnNumberStart < 1
  ) {
    log.warn("sharedFile", `OMC places ${typeName} nowhere in ${filename}`);
    await restoreBuffer(client, filename, text);
    return undefined;
  }

  return {
    firstLine: inFile.lineNumberStart,
    lastLine: inFile.lineNumberEnd,
    lineShift: inFile.lineNumberStart - inBuffer.lineNumberStart,
    columnShift: inFile.columnNumberStart - inBuffer.columnNumberStart,
  };
}

/**
 * Undo the file reload by loading the buffer back over it. Leaving the file's
 * numbering in place while the caller reads positions as the buffer's would
 * drop the class's own diagnostics and admit its siblings' — the pair of
 * mistakes the alignment exists to prevent.
 */
async function restoreBuffer(
  client: SharedFileClient,
  filename: string,
  text: string,
): Promise<void> {
  try {
    await client.loadString({ data: text, filename, merge: false });
  } catch (err) {
    log.error("sharedFile", `could not restore ${filename} to the buffer`, err);
  }
}

/**
 * Keep the messages against `filename` that fall inside `coords`, carried back
 * to buffer coordinates. A message against any other file passes through
 * untouched — the caller's resolver decides where it belongs.
 */
export function keepForBuffer(
  messages: readonly ErrorMessage[],
  filename: string,
  coords: BufferCoords,
): ErrorMessage[] {
  const kept: ErrorMessage[] = [];
  for (const msg of messages) {
    // A message with no source location is not a position to bound or shift.
    if (msg.info.filename !== filename || hasNoSourceLocation(msg.info)) {
      kept.push(msg);
      continue;
    }
    if (
      msg.info.lineStart < coords.firstLine ||
      msg.info.lineStart > coords.lastLine
    ) {
      continue;
    }
    kept.push(toBufferCoords(msg, coords));
  }
  return kept;
}

/** Bounds nothing in — every located message against the file is dropped. */
const NOTHING_IN_BOUNDS: BufferCoords = {
  firstLine: 1,
  lastLine: 0,
  lineShift: 0,
  columnShift: 0,
};

/**
 * Load `typeName`'s own current source standalone under `filename` to get a
 * known buffer position, then align it back from the shared file's
 * coordinate space. For a caller with no live document object (unlike
 * `live-check.ts`, which already has the user's edited buffer text to load),
 * `typeName`'s own {@link SharedFileClient.listFile} output stands in for it.
 *
 * Returns `undefined` when `typeName` owns `filename` outright (the common,
 * one-class-per-file case) — nothing to align, skip the reload entirely and
 * leave messages unbounded.
 *
 * When the standalone reload lands but `alignToSharedFile` declines to map
 * (e.g. OMC can't place the class in the reloaded file), it has left OMC
 * holding the buffer's own coordinates, so those are exactly what the caller
 * should read — `bufferOwnCoords` reflects that. Only when the reload itself
 * fails or something throws do we know nothing about the coordinate space OMC
 * is in; that's the one case {@link NOTHING_IN_BOUNDS} guards, dropping every
 * located message rather than publishing a sibling's diagnostic under a class
 * it doesn't belong to.
 */
export async function alignOwnSourceToSharedFile(
  client: SharedFileClient,
  input: { typeName: string; filename: string },
): Promise<BufferCoords | undefined> {
  const { typeName, filename } = input;
  const owner = await fileOwnerClass(client, typeName);
  if (owner === typeName) return undefined;

  try {
    const { contents } = await client.listFile({ typeName });
    const { success } = await client.loadString({
      data: contents,
      filename,
      merge: false,
    });
    if (!success) {
      log.warn(
        "sharedFile",
        `reloading ${typeName}'s own source under ${filename} failed`,
      );
      return NOTHING_IN_BOUNDS;
    }
    return (
      (await alignToSharedFile(client, {
        typeName,
        filename,
        text: contents,
      })) ?? bufferOwnCoords(contents.split("\n").length)
    );
  } catch (err) {
    log.warn(
      "sharedFile",
      `could not align ${typeName} to ${filename}; dropping its diagnostics rather than risk a wrong position`,
      err,
    );
    return NOTHING_IN_BOUNDS;
  }
}

function toBufferCoords(msg: ErrorMessage, coords: BufferCoords): ErrorMessage {
  const { info } = msg;
  const shiftColumn = (column: number): number =>
    column === 0 ? 0 : column - coords.columnShift;
  return {
    ...msg,
    info: {
      ...info,
      lineStart: info.lineStart - coords.lineShift,
      lineEnd: Math.min(info.lineEnd, coords.lastLine) - coords.lineShift,
      columnStart: shiftColumn(info.columnStart),
      columnEnd: shiftColumn(info.columnEnd),
    },
  };
}
