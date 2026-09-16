/**
 * The write gate every mutating MCP tool passes through.
 *
 * `WriteVerdicts` answers "may this class be written?" per class, and an
 * assistant is the caller most likely to try editing
 * `Modelica.Electrical.Analog.Basic.Resistor` and most in need of being told
 * why it cannot, in a sentence it can relay. What the verdict needs is a class
 * name, and what a tool call carries is a named-argument object — so the gate
 * is one table saying which argument of each mutating function holds it.
 *
 * `MUTATIONS` in `@dicode/omc-client` answers the same question for the *command
 * string*, by argument position. That table cannot be reused here: the gate runs
 * before the call, when only the input object exists, and the wrapper's field
 * order is not its command's argument order. The two also disagree on purpose —
 * `copyClass`, `newModel` and `deleteClass` announce coarsely because no single
 * command argument names what they touched, while their input objects do.
 *
 * The table is exhaustive over `MutatingFnName` and each field name is checked
 * against that function's own input type, so a new mutating wrapper — or a
 * renamed argument — fails the build rather than shipping an ungated tool.
 *
 * Three rows do not name a class directly: `loadString` carries Modelica text,
 * and `loadFile`/`loadFiles` carry a path (or paths) to it — in every case the
 * `within` clause inside the Modelica chooses the target that no argument of
 * the call does. OMC parses the text or the file to say what it declares, and
 * each declared class is judged like any other.
 *
 * A row naming a list judges each of its arguments in turn, because one
 * argument is not always the whole of what a call writes. `loadString`'s
 * `filename` binds what its text declares to that path and `setSourceFile`'s
 * `fileName` repoints the class its `typeName` names at one; either way the
 * path's own classes are evicted, and a later `save` rewrites the file from the
 * bound class alone. Judging the destination is the only way a class the caller
 * owns, whose own verdict has no reason to refuse, is stopped from taking over
 * a library file.
 *
 * `save` rewrites a class's own source file without touching OMC's symbol
 * table, so `MUTATIONS` in `@dicode/omc-client` classifies it `"readOnly"` and
 * it is not a `MutatingFnName` — yet it reaches OMC through the same
 * `omc_invoke` path as every gated wrapper, and is gated by its own entry
 * below. That classification is what lets `MUTATIONS` keep meaning "changes
 * the model in memory", which is what cache invalidation reads it for.
 */

import { enclosingScope } from "@dicode/modelica-lang-core";
import { isLikelyDiskPath } from "@dicode/omc-client";
import type { MutatingFnName, OmcFnName, OmcInput } from "@dicode/omc-client";

import { errorDetail } from "./error-detail.js";

import type {
  WriteAction,
  WriteVerdictClient,
  WriteVerdictSource,
} from "./write-verdict.js";

/**
 * The OMC the gate calls on its own account, to find what a call writes before
 * asking whether it may. None of them loads anything, so all three can run
 * ahead of the write they screen. `OmcClient` satisfies it.
 */
export interface WriteTargetClient {
  parseString(input: { data: string }): Promise<{ classNames: string[] }>;
  parseFile(input: {
    fileName: string;
    encoding?: string;
  }): Promise<{ classNames: string[] }>;
  existClass(input: { typeName: string }): Promise<{ exists: boolean }>;
}

/**
 * How `K`'s input says what the call would write, and what the caller is doing
 * to it.
 *
 * `as: "element"` marks an argument holding a dotted path to an element *inside*
 * a class; its enclosing scope is what gets written.
 *
 * `as: "source"` marks an argument holding Modelica text the call brings in,
 * and `as: "sourceFile"` / `"sourceFiles"` a path (or array of paths) to a file
 * holding it — `encodingField`, when given, names the sibling argument the
 * call reads the file with, so the gate decodes it the same way the load will.
 * In every case the target is not the argument itself: its own `within`
 * clause chooses it, so no sibling argument names one and OMC parses the text
 * or the file to say what it declares; the action follows per declared class
 * rather than being fixed here.
 *
 * `as: "binding"` marks a path the call *sends* something to rather than reads
 * from: whatever the path holds is evicted, so its classes are judged the same
 * way a loaded file's are. Nothing reads a binding path into the call, so none
 * of the call's encodings applies to it, and a value that is not a path on disk
 * is judged by nothing — `loadString`'s `filename` defaults to `<interactive>`
 * and a class created in memory carries the `<runtime:…>` pseudo-path that
 * `setSourceFile` replaces once it reaches disk. Neither is a file anything is
 * stored in, so neither has anything for a binding to evict.
 *
 * A list judges its arguments left to right over one set of settled targets, so
 * the cheapest verdict is reached first and a target two arguments share is
 * asked about once.
 *
 * `null` means the input says nothing the gate judges: a library or an FMU
 * named rather than written (`loadModel`, `installPackage`, `importFMU`), or
 * OMC's own state (`setCommandLineOptions`).
 */
type Argument<Field extends string> =
  | {
      readonly field: Field;
      readonly as: "class" | "element";
      readonly action: WriteAction;
    }
  | {
      readonly field: Field;
      readonly as: "source" | "binding";
    }
  | {
      readonly field: Field;
      readonly as: "sourceFile" | "sourceFiles";
      readonly encodingField?: Field;
    };

/**
 * A row: the one argument the gate judges, the several it judges in order, or
 * `null`. Each argument carries its own field name as a literal, and only a
 * name `K`'s input actually has is assignable here — so a renamed argument
 * fails the build.
 */
type ClassArgument<K extends OmcFnName> =
  | Argument<Extract<keyof OmcInput<K>, string>>
  | readonly Argument<Extract<keyof OmcInput<K>, string>>[]
  | null;

const edits = <F extends string>(field: F): Argument<F> => ({
  field,
  as: "class",
  action: "edit",
});

const createsInside = <F extends string>(field: F): Argument<F> => ({
  field,
  as: "class",
  action: "createInside",
});

const editsElement = <F extends string>(field: F): Argument<F> => ({
  field,
  as: "element",
  action: "edit",
});

const declaresInSource = <F extends string>(field: F): Argument<F> => ({
  field,
  as: "source",
});

const binds = <F extends string>(field: F): Argument<F> => ({
  field,
  as: "binding",
});

const fileArgument = <F extends string>(
  as: "sourceFile" | "sourceFiles",
  field: F,
  encodingField?: F,
): Argument<F> =>
  encodingField === undefined ? { field, as } : { field, as, encodingField };

const declaresInFile = <F extends string>(
  field: F,
  encodingField?: F,
): Argument<F> => fileArgument("sourceFile", field, encodingField);

const declaresInFiles = <F extends string>(
  field: F,
  encodingField?: F,
): Argument<F> => fileArgument("sourceFiles", field, encodingField);

/**
 * `copyClass`'s `within` and `newModel`'s `withinPath` are empty for a
 * top-level class. An empty name has no verdict to derive, so the gate lets it
 * through — the same way a lookup that fails does.
 */
const CLASS_ARGUMENTS: { readonly [K in MutatingFnName]: ClassArgument<K> } = {
  addClassAnnotation: edits("typeName"),
  addComponent: edits("intoTypeName"),
  addConnection: edits("typeName"),
  addInitialState: edits("typeName"),
  addTransition: edits("typeName"),
  copyClass: createsInside("within"),
  deleteClass: edits("typeName"),
  deleteComponent: edits("typeName"),
  deleteConnection: edits("typeName"),
  deleteInitialState: edits("typeName"),
  deleteTransition: edits("typeName"),
  importFMU: null,
  installPackage: null,
  loadClassContentString: createsInside("typeName"),
  loadFile: declaresInFile("fileName", "encoding"),
  loadFiles: declaresInFiles("fileNames", "encoding"),
  loadModel: null,
  loadString: [declaresInSource("data"), binds("filename")],
  moveClass: edits("typeName"),
  moveClassToBottom: edits("typeName"),
  moveClassToTop: edits("typeName"),
  newModel: createsInside("withinPath"),
  removeComponentModifiers: edits("typeName"),
  removeElementModifiers: edits("typeName"),
  removeExtendsModifiers: edits("typeName"),
  renameClass: edits("typeName"),
  renameComponent: edits("typeName"),
  renameComponentInClass: edits("typeName"),
  setClassComment: edits("typeName"),
  setCommandLineOptions: null,
  setComponentComment: edits("typeName"),
  setComponentDimensions: edits("typeName"),
  setComponentModifierValue: edits("typeName"),
  setComponentProperties: edits("typeName"),
  setDocumentationAnnotation: edits("typeName"),
  setElementAnnotation: editsElement("typeName"),
  setElementModifierValue: edits("typeName"),
  setElementType: edits("typeName"),
  setExtendsModifier: edits("typeName"),
  setExtendsModifierValue: edits("typeName"),
  setFullDocumentationAnnotation: edits("typeName"),
  setParameterValue: edits("typeName"),
  setSourceFile: [edits("typeName"), binds("fileName")],
  updateComponent: edits("intoTypeName"),
  updateConnection: edits("typeName"),
  updateConnectionNames: edits("typeName"),
  updateInitialState: edits("typeName"),
  updateTransition: edits("typeName"),
  upgradeInstalledPackages: null,
  writeClassGraphics: edits("typeName"),
};

/**
 * Naming `save` as `ClassArgument`'s own type argument is what fails the build
 * if it ever leaves the OMC function registry or renames `typeName`.
 */
const SAVE_ARGUMENT: ClassArgument<"save"> = {
  field: "typeName",
  as: "class",
  action: "save",
};

/**
 * `CLASS_ARGUMENTS` and `SAVE_ARGUMENT` with their per-function field-name
 * literals erased, which is all a lookup by a runtime name can preserve.
 */
type ResolvedArgument = Argument<string>;

const BY_NAME: Readonly<
  Record<
    string,
    ResolvedArgument | readonly ResolvedArgument[] | null | undefined
  >
> = { save: SAVE_ARGUMENT, ...CLASS_ARGUMENTS };

/**
 * The refusal `fn` earns for `input`, or `undefined` when the call may proceed.
 *
 * Read-only functions, and mutating ones whose input neither names a class nor
 * carries Modelica text or a path to it, return `undefined` without asking
 * OMC anything.
 */
export async function refusalFor(
  verdicts: WriteVerdictSource,
  client: WriteVerdictClient & WriteTargetClient,
  fn: OmcFnName,
  input: unknown,
): Promise<string | undefined> {
  const row = BY_NAME[fn];
  if (row === undefined || row === null) return undefined;
  if (typeof input !== "object" || input === null) return undefined;

  // One set across the whole row, so a target two arguments share — text
  // declaring the class its own bound file holds, a class repointed at the
  // file it is already stored in — is asked about once.
  const passed = new Set<string>();
  for (const argument of Array.isArray(row) ? row : [row]) {
    const refusal = await refusalForArgument(
      verdicts,
      client,
      input,
      argument,
      passed,
    );
    if (refusal !== undefined) return refusal;
  }
  return undefined;
}

/**
 * The refusal one argument of a call earns, or `undefined` when what it names
 * is the caller's to write.
 *
 * `passed` collects every target settled so far, this argument's included, so
 * the arguments after it in the row skip what this one already asked about.
 */
async function refusalForArgument(
  verdicts: WriteVerdictSource,
  client: WriteVerdictClient & WriteTargetClient,
  input: object,
  argument: ResolvedArgument,
  passed: Set<string>,
): Promise<string | undefined> {
  const raw: unknown = (input as Record<string, unknown>)[argument.field];

  // One switch, not a chain of `if`s narrowing `argument.as` away by
  // elimination: TypeScript's flow analysis only narrows a discriminated
  // union's *structural* member (here, which sibling-argument fields it
  // carries) per `case`, not across several `if (argument.as === …) return …`
  // checks that together rule the other members out.
  switch (argument.as) {
    case "class":
    case "element": {
      if (typeof raw !== "string" || raw === "") return undefined;
      const className = argument.as === "element" ? enclosingScope(raw) : raw;
      const refusal = await refusalForClass(
        verdicts,
        client,
        className,
        argument.action,
      );
      if (refusal !== undefined) return refusal;
      passed.add(className);
      return undefined;
    }
    case "source": {
      if (typeof raw !== "string" || raw === "") return undefined;
      return refusalForSource(verdicts, client, raw, passed);
    }
    case "binding": {
      if (typeof raw !== "string" || !isLikelyDiskPath(raw)) return undefined;
      return refusalForSourceFile(verdicts, client, raw, undefined, passed);
    }
    case "sourceFile": {
      if (typeof raw !== "string" || raw === "") return undefined;
      return refusalForSourceFile(
        verdicts,
        client,
        raw,
        readEncoding(input, argument.encodingField),
        passed,
      );
    }
    case "sourceFiles": {
      if (!Array.isArray(raw)) return undefined;
      const encoding = readEncoding(input, argument.encodingField);
      for (const fileName of raw) {
        if (typeof fileName !== "string" || fileName === "") continue;
        const refusal = await refusalForSourceFile(
          verdicts,
          client,
          fileName,
          encoding,
          passed,
        );
        if (refusal !== undefined) return refusal;
      }
      return undefined;
    }
    default: {
      const unreachable: never = argument;
      throw new Error(
        `write-gate: unhandled argument shape ${JSON.stringify(unreachable)}`,
      );
    }
  }
}

/**
 * `field`'s value in `input` when it names one and reads as a string, so
 * `parseFile` decodes a file the same way `loadFile`/`loadFiles`' own
 * `encoding` argument will. `undefined` — no such field, or a non-string
 * value — leaves `parseFile` to its own UTF-8 default, which is also
 * `loadFile`/`loadFiles`' default.
 */
function readEncoding(
  input: object,
  field: string | undefined,
): string | undefined {
  if (field === undefined) return undefined;
  const raw: unknown = (input as Record<string, unknown>)[field];
  return typeof raw === "string" ? raw : undefined;
}

/**
 * The refusal `code` earns for the classes it declares, or `undefined` when
 * every one of them is the caller's to write.
 *
 * Text OMC cannot parse declares nothing, so there is nothing to judge and the
 * load that follows surfaces the parse failure. A `parseString` that fails
 * outright is the other thing entirely: the gate never learned what the call
 * writes, so it refuses. A verdict lookup fails open because refusing there
 * would lock a user out of a model that is theirs to edit; refusing here costs
 * one retry, and allowing would be a write nothing judged.
 */
async function refusalForSource(
  verdicts: WriteVerdictSource,
  client: WriteVerdictClient & WriteTargetClient,
  code: string,
  passed: Set<string>,
): Promise<string | undefined> {
  let classNames: string[];
  try {
    ({ classNames } = await client.parseString({ data: code }));
  } catch (err) {
    return `Cannot tell which class this would write — OMC could not read the source: ${errorDetail(err)}.`;
  }
  return refusalForDeclaredClasses(verdicts, client, classNames, passed);
}

/**
 * {@link refusalForSource}'s file-shaped twin: `fileName` is read through
 * `parseFile` instead of `data` through `parseString`, and judged the same way.
 * It answers for both a file a call loads and a path a call binds a class to —
 * what the file holds is what the call takes over, either way.
 *
 * `encoding` is read the same way the real `loadFile`/`loadFiles` call will, so
 * the gate never decodes the file differently than the load that follows. A
 * binding path is read by no call, so it has no encoding to match and leaves
 * `parseFile` its UTF-8 default.
 *
 * `passed` comes from the caller, which shares one set wherever a target can
 * repeat — across a `loadFiles` batch, or between a binding path and whatever
 * was judged before it — so a target named twice is still asked about once.
 */
async function refusalForSourceFile(
  verdicts: WriteVerdictSource,
  client: WriteVerdictClient & WriteTargetClient,
  fileName: string,
  encoding: string | undefined,
  passed: Set<string>,
): Promise<string | undefined> {
  let classNames: string[];
  try {
    ({ classNames } = await client.parseFile(
      encoding === undefined ? { fileName } : { fileName, encoding },
    ));
  } catch (err) {
    return `Cannot tell which class this would write — OMC could not read ${fileName}: ${errorDetail(err)}.`;
  }
  return refusalForDeclaredClasses(verdicts, client, classNames, passed);
}

/**
 * The refusal `classNames` earns, or `undefined` when every one of them is the
 * caller's to write.
 *
 * A name already in the symbol table is being replaced, so the class itself is
 * judged; one that is not is being created, so its `within` scope is judged
 * instead. That scope is always a class OMC knows: a load refuses a `within`
 * clause naming a package it cannot find, so the only scope a write can reach
 * is one that already exists. A bare name has no scope at all, which is a
 * top-level class the gate has no verdict for.
 *
 * A target in `passed` is not asked about twice — several classes (in one
 * `within` clause, or in different files of one `loadFiles` batch) can share a
 * scope, and {@link WriteVerdictSource} answers by class, with `action`
 * selecting only the wording of a refusal.
 */
async function refusalForDeclaredClasses(
  verdicts: WriteVerdictSource,
  client: WriteVerdictClient & WriteTargetClient,
  classNames: string[],
  passed: Set<string>,
): Promise<string | undefined> {
  for (const className of classNames) {
    const { exists } = await client.existClass({ typeName: className });
    const target = exists ? className : enclosingScope(className);
    if (target === "" || passed.has(target)) continue;

    const refusal = await refusalForClass(
      verdicts,
      client,
      target,
      exists ? "edit" : "createInside",
    );
    if (refusal !== undefined) return refusal;
    passed.add(target);
  }
  return undefined;
}

/**
 * The refusal `className` earns, for a tool that knows which class it writes
 * even though the wrapper it dispatches does not name one. An empty name has no
 * verdict to derive, so it passes — the same way a lookup that fails does.
 */
export async function refusalForClass(
  verdicts: WriteVerdictSource,
  client: WriteVerdictClient,
  className: string,
  action: WriteAction,
): Promise<string | undefined> {
  if (className === "") return undefined;
  const verdict = await verdicts.forClass(client, className, action);
  return verdict.ok ? undefined : verdict.reason;
}
