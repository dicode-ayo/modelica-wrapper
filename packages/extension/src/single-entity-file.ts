/**
 * Modelica spec §13.2.2.2: a nonstructured entity — a plain `.mo` file — holds
 * one stored-definition, defining a class whose name matches the file. OMC
 * accepts a file declaring several top-level classes anyway, and once it has,
 * those classes share one `getSourceFile` path with no dotted relationship to
 * climb between them: saving any one of them rewrites the file from that class
 * alone and drops the rest (issue #452).
 *
 * OMEdit refuses such a file at the door rather than reconciling it on save
 * (`LibraryWidget::multipleTopLevelClasses`), directing the user to scripting
 * `loadFile` instead. The load paths behind the UI do the same; the REPL is
 * that scripting environment and stays open.
 *
 * Text entering OMC through `loadString` needs the same screen: it binds every
 * class in the text to the filename it is given, so an unscreened buffer mints
 * the shape on a file that parses clean from disk.
 */

import * as path from "node:path";

import { enclosingScope, leafName } from "@dicode/modelica-lang-core";

import { errorDetail } from "./error-detail.js";
import { log } from "./logger.js";

/** OMC surface the file-based check calls. `OmcClient` satisfies it. */
export interface FileParseClient {
  parseFile(input: { fileName: string }): Promise<{ classNames: string[] }>;
}

/** OMC surface the text-based check calls. `OmcClient` satisfies it. */
export interface StringParseClient {
  parseString(input: {
    data: string;
    filename: string;
  }): Promise<{ classNames: string[] }>;
}

/**
 * The top-level classes `fileName` declares when it declares more than one,
 * `undefined` when it holds a single entity. A file OMC cannot parse also
 * answers `undefined` — at the load sites the load that follows reports the
 * parse failure with more context than a refusal here could. Callers with no
 * such follow-up own that choice themselves.
 */
export async function multipleTopLevelClasses(
  client: FileParseClient,
  fileName: string,
): Promise<string[] | undefined> {
  let classNames: string[];
  try {
    ({ classNames } = await client.parseFile({ fileName }));
  } catch (err) {
    log.warn(
      "singleEntity",
      `parseFile ${fileName} failed: ${errorDetail(err)}`,
    );
    return undefined;
  }
  return moreThanOne(classNames);
}

/**
 * The classes a buffer about to be `loadString`ed under `filename` declares.
 * `undefined` when OMC couldn't parse it — the load that follows reports that
 * failure with more context than a refusal here could. `parseString` leaves
 * OMC's class registry untouched, so this can run ahead of the load it
 * guards.
 */
export async function bufferClassNames(
  client: StringParseClient,
  data: string,
  filename: string,
): Promise<string[] | undefined> {
  try {
    const { classNames } = await client.parseString({ data, filename });
    return classNames;
  } catch (err) {
    log.warn(
      "singleEntity",
      `parseString for ${filename} failed: ${errorDetail(err)}`,
    );
    return undefined;
  }
}

export function moreThanOne(classNames: string[]): string[] | undefined {
  return classNames.length > 1 ? classNames : undefined;
}

/**
 * The name a single-entity buffer declares, when it isn't `expected` — a save
 * that renamed the class its URI addresses in text, or moved it under a
 * different `within` scope. Either way `loadString` binds every class in a
 * buffer to the filename it's given rather than replacing the file's
 * contents, so the buffer parses clean and loads as a second, unreachable
 * class alongside the one the save meant to replace (#459). Meaningless once
 * `classNames` holds more than one name — the multiple-top-level-classes
 * screen already refuses that buffer outright.
 *
 * `parseString` may (like `parseFile`, see `language/owning-class.ts`'s
 * `confirmLeaf`) return a name qualified by the buffer's own `within` clause.
 * A bare answer carries no scope of its own — a plain member buffer with no
 * `within` clause parses bare whether or not it moved, so only its leaf can
 * be compared. A qualified answer names both scope and leaf, so it must match
 * `expected` outright: leaf-only comparison would miss a `within` edit that
 * kept the same leaf name but pointed the class at a different package.
 */
export function renamedClass(
  classNames: string[],
  expected: string,
): string | undefined {
  if (classNames.length !== 1) return undefined;
  const [only] = classNames;
  if (only === undefined) return undefined;
  const moved =
    enclosingScope(only) === ""
      ? leafName(only) !== leafName(expected)
      : only !== expected;
  return moved ? only : undefined;
}

/** Shared refusal wording, so every guard site names the same recovery. */
export function multiEntityMessage(
  fileName: string,
  classNames: string[],
): string {
  return (
    `${fileName} declares more than one top-level class ` +
    `(${classNames.join(", ")}). Modelica stores one class per file, and ` +
    `saving any one of them here would drop the others — split them into a ` +
    `file each, or load the file through the Modelica REPL.`
  );
}

/**
 * Shared refusal wording for a buffer that renamed its class (#459).
 * `consequence` names what the guard refused to do — the default fits a save;
 * a caller refusing something else (e.g. a live check refusing to load) names
 * its own.
 */
export function renamedClassMessage(
  expected: string,
  declared: string,
  consequence = `Saving here would leave ${expected} alive in OMC's memory, unreachable from its own file`,
): string {
  return (
    `This buffer is ${expected}'s source, but it now declares ${declared}. ` +
    `${consequence} — rename through the Modelica REPL instead.`
  );
}

/**
 * The refusal message a set of already-parsed class names earns before
 * `loadString`, `undefined` when it passes both screens. Runs the
 * multi-entity screen before the rename screen: `renamedClass` is
 * meaningless once `classNames` holds more than one name. `label` names the
 * file in a multi-entity refusal when it differs from `filename` —
 * `writeFile` refuses by `typeName` for a memory-only class that has no
 * on-disk `filename` of its own yet. `expected` is `undefined` for a caller
 * with no known class to rename away from, which skips the rename screen but
 * still runs the multi-entity one. `renamedConsequence` is
 * {@link renamedClassMessage}'s `consequence`.
 */
export function classNamesRefusal(
  classNames: string[],
  input: {
    filename: string;
    expected: string | undefined;
    label?: string;
    renamedConsequence?: string | undefined;
  },
): string | undefined {
  const multiEntity = moreThanOne(classNames);
  if (multiEntity !== undefined) {
    return multiEntityMessage(input.label ?? input.filename, multiEntity);
  }
  if (input.expected === undefined) return undefined;
  const renamed = renamedClass(classNames, input.expected);
  return renamed === undefined
    ? undefined
    : renamedClassMessage(input.expected, renamed, input.renamedConsequence);
}

/**
 * The refusal message a buffer earns before `loadString`, `undefined` when it
 * passes both screens (or OMC couldn't parse it — the load that follows
 * reports that failure itself). `expected` and `label` are as
 * {@link classNamesRefusal} documents them.
 */
export async function bufferRefusal(
  client: StringParseClient,
  input: { data: string; filename: string; expected: string; label?: string },
): Promise<string | undefined> {
  const classNames = await bufferClassNames(client, input.data, input.filename);
  if (classNames === undefined) return undefined;
  return classNamesRefusal(classNames, input);
}

/** Batch notification; the per-file detail stays in the output channel. */
export function multiEntityBatchToast(fileNames: string[]): string {
  const names = fileNames.map((f) => path.basename(f)).join(", ");
  return (
    `Modelica: ${names} left unloaded — a .mo file must declare a single ` +
    `top-level class. See the Modelica output channel for details.`
  );
}

/** Per-file notification; `consequence` names what the guard refused to do. */
export function multiEntityToast(
  fileName: string,
  classNames: string[],
  consequence: string,
): string {
  return (
    `Modelica: ${path.basename(fileName)} declares ${classNames.join(", ")}, ` +
    `so ${consequence}. Split them into a file each — saving one here would ` +
    `drop the others.`
  );
}
