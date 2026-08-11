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

import { fileOwnerClass, type FileOwnerClient } from "./file-owner.js";

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
 */
export async function alignToSharedFile(
  client: SharedFileClient,
  typeName: string,
  filename: string,
): Promise<BufferCoords | undefined> {
  const owner = await fileOwnerClass(client, typeName);
  if (owner === typeName) return undefined;

  const inBuffer = await client.getClassInformation({ typeName });
  if (inBuffer.lineNumberStart < 1 || inBuffer.columnNumberStart < 1) {
    return undefined;
  }

  const { contents } = await client.listFile({ typeName: owner });
  // Loading an empty listing would drop the file's classes from OMC rather
  // than renumber them.
  if (contents.trim() === "") return undefined;
  const { success } = await client.loadString({
    data: contents,
    filename,
    merge: false,
  });
  if (!success) return undefined;

  const inFile = await client.getClassInformation({ typeName });
  if (
    inFile.lineNumberStart < 1 ||
    inFile.lineNumberEnd < inFile.lineNumberStart ||
    inFile.columnNumberStart < 1
  ) {
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
    // `lineStart: 0` is OMC's marker for a message with no source location
    // (see `omcToVscodePosition`), not a position to bound or shift.
    if (msg.info.filename !== filename || msg.info.lineStart === 0) {
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
