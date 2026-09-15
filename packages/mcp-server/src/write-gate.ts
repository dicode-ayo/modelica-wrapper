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
 * `save` rewrites a class's own source file without touching OMC's symbol
 * table, so `MUTATIONS` in `@dicode/omc-client` classifies it `"readOnly"` and
 * it is not a `MutatingFnName` — yet it reaches OMC through the same
 * `omc_invoke` path as every gated wrapper, and is gated by its own entry
 * below. That classification is what lets `MUTATIONS` keep meaning "changes
 * the model in memory", which is what cache invalidation reads it for.
 */

import { enclosingScope } from "@dicode/modelica-lang-core";
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
      readonly as: "source" | "sourceFile" | "sourceFiles";
      readonly encodingField?: Field;
    };

type ClassArgument<K extends OmcFnName> = Argument<
  Extract<keyof OmcInput<K>, string>
> | null;

const edits = <K extends OmcFnName>(
  field: Extract<keyof OmcInput<K>, string>,
): ClassArgument<K> => ({ field, as: "class", action: "edit" });

const createsInside = <K extends OmcFnName>(
  field: Extract<keyof OmcInput<K>, string>,
): ClassArgument<K> => ({ field, as: "class", action: "createInside" });

const editsElement = <K extends OmcFnName>(
  field: Extract<keyof OmcInput<K>, string>,
): ClassArgument<K> => ({ field, as: "element", action: "edit" });

const declaresInSource = <K extends OmcFnName>(
  field: Extract<keyof OmcInput<K>, string>,
): ClassArgument<K> => ({ field, as: "source" });

const declaresInFile = <K extends OmcFnName>(
  field: Extract<keyof OmcInput<K>, string>,
  encodingField?: Extract<keyof OmcInput<K>, string>,
): ClassArgument<K> =>
  encodingField === undefined
    ? { field, as: "sourceFile" }
    : { field, as: "sourceFile", encodingField };

const declaresInFiles = <K extends OmcFnName>(
  field: Extract<keyof OmcInput<K>, string>,
  encodingField?: Extract<keyof OmcInput<K>, string>,
): ClassArgument<K> =>
  encodingField === undefined
    ? { field, as: "sourceFiles" }
    : { field, as: "sourceFiles", encodingField };

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
  loadString: declaresInSource("data"),
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
  setSourceFile: edits("typeName"),
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
type ResolvedClassArgument = Argument<string>;

const BY_NAME: Readonly<
  Record<string, ResolvedClassArgument | null | undefined>
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
  const argument = BY_NAME[fn];
  if (argument === undefined || argument === null) return undefined;
  if (typeof input !== "object" || input === null) return undefined;

  const raw: unknown = (input as Record<string, unknown>)[argument.field];

  // One switch, not a chain of `if`s narrowing `argument.as` away by
  // elimination: TypeScript's flow analysis only narrows a discriminated
  // union's *structural* member (here, whether `encodingField` exists) per
  // `case`, not across several `if (argument.as === …) return …` checks that
  // together rule the other member out.
  switch (argument.as) {
    case "class":
    case "element": {
      if (typeof raw !== "string" || raw === "") return undefined;
      const className = argument.as === "element" ? enclosingScope(raw) : raw;
      return refusalForClass(verdicts, client, className, argument.action);
    }
    case "source":
    case "sourceFile": {
      if (typeof raw !== "string" || raw === "") return undefined;
      const encoding = readEncoding(input, argument.encodingField);
      return argument.as === "source"
        ? refusalForSource(verdicts, client, raw)
        : refusalForSourceFile(verdicts, client, raw, encoding);
    }
    case "sourceFiles": {
      if (!Array.isArray(raw)) return undefined;
      const encoding = readEncoding(input, argument.encodingField);
      // Shared across every file in the batch so a `within` scope several of
      // them declare into is asked about once, the same as within one file.
      const passed = new Set<string>();
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
  passed = new Set<string>(),
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
 * `encoding` is read the same way the real `loadFile`/`loadFiles` call will,
 * so the gate never decodes the file differently than the load that follows.
 *
 * `passed` defaults to a fresh set for a lone file, and is shared across a
 * `loadFiles` batch by its caller so a scope named from more than one file is
 * still asked about once.
 */
async function refusalForSourceFile(
  verdicts: WriteVerdictSource,
  client: WriteVerdictClient & WriteTargetClient,
  fileName: string,
  encoding: string | undefined,
  passed = new Set<string>(),
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
 * instead. That scope is always a class OMC knows: `loadString` refuses a
 * `within` clause naming a package it cannot find, so the only scope a write
 * can reach is one that already exists. A bare name has no scope at all, which
 * is a top-level class the gate has no verdict for.
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
