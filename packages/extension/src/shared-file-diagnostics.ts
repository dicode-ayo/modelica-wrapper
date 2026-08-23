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
 *
 * `owner`, when passed, is `typeName`'s already-known file owner (from a
 * caller that had to compute it anyway, e.g. `alignOwnSourceToSharedFile`) —
 * skips redoing the `fileOwnerClass` walk here.
 */
export async function alignToSharedFile(
  client: SharedFileClient,
  input: { typeName: string; filename: string; text: string; owner?: string },
): Promise<BufferCoords | undefined> {
  const { typeName, filename, text } = input;
  const owner = input.owner ?? (await fileOwnerClass(client, typeName));
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

/**
 * Bounds nothing in — every located message against the file is dropped.
 * `bufferOwnCoords(0)` already has this shape (`firstLine` 1 > `lastLine` 0
 * excludes every located message); named separately so a caller reads intent
 * ("nothing is trustworthy") rather than a zero-length buffer.
 */
const NOTHING_IN_BOUNDS: BufferCoords = bufferOwnCoords(0);

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
 * When the standalone reload lands, `alignToSharedFile` takes over: it either
 * maps the file's coordinates back, or (when it declines to map, or its own
 * extent read throws) leaves OMC holding the buffer's own coordinates and
 * either returns `undefined` or rethrows — its own doc comment promises this.
 * Either way that is a known-good state, so its `undefined` return and its
 * thrown errors both propagate here as "read the buffer's own coordinates",
 * not "unknown". Only a failure in *this* function's own reload — before
 * `alignToSharedFile` is ever reached, so nothing is known about OMC's state —
 * returns {@link NOTHING_IN_BOUNDS}, dropping every located message rather
 * than publishing a sibling's diagnostic under a class it doesn't belong to.
 */
export async function alignOwnSourceToSharedFile(
  client: SharedFileClient,
  input: { typeName: string; filename: string },
): Promise<BufferCoords | undefined> {
  const { typeName, filename } = input;
  const owner = await fileOwnerClass(client, typeName);
  if (owner === typeName) return undefined;

  let contents: string;
  let success: boolean;
  try {
    ({ contents } = await client.listFile({ typeName }));
    ({ success } = await client.loadString({
      data: contents,
      filename,
      merge: false,
    }));
  } catch (err) {
    log.warn(
      "sharedFile",
      `could not read or reload ${typeName}'s own source under ${filename}; dropping its diagnostics rather than risk a wrong position`,
      err,
    );
    return NOTHING_IN_BOUNDS;
  }
  if (!success) {
    log.warn(
      "sharedFile",
      `reloading ${typeName}'s own source under ${filename} failed`,
    );
    return NOTHING_IN_BOUNDS;
  }

  // `alignToSharedFile` either maps the file's coordinates back, or leaves
  // OMC holding the buffer's own coordinates and returns `undefined` or
  // rethrows — both are a known-good state, not "unknown", so neither is
  // caught here. `owner` is already known, so this skips redoing the walk.
  return (
    (await alignToSharedFile(client, {
      typeName,
      filename,
      text: contents,
      owner,
    })) ?? bufferOwnCoords(contents.split("\n").length)
  );
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
