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
 * A call that carries Modelica text answers to a second table. Its target is in
 * the text — a `within` clause and a class name — rather than in a sibling
 * argument, so no field of it can be read as a class name and `parseString`
 * reads the text instead. Both tables are consulted, because a call may sit in
 * both.
 */

import { enclosingScope } from "@dicode/modelica-lang-core";
import type { MutatingFnName, OmcFnName, OmcInput } from "@dicode/omc-client";

import type {
  WriteAction,
  WriteVerdictClient,
  WriteVerdictSource,
} from "./write-verdict.js";

/**
 * The OMC call that answers what a source string declares, fully qualified by
 * its own `within` clause. It loads nothing, so it can run ahead of the write
 * it screens. `OmcClient` satisfies it.
 */
export interface SourceParseClient {
  parseString(input: { data: string }): Promise<{ classNames: string[] }>;
}

/**
 * Which argument of `K` names the class a call would write, and what the caller
 * is doing to it.
 *
 * `as: "element"` marks an argument holding a dotted path to an element *inside*
 * a class; its enclosing scope is what gets written.
 *
 * `null` means no field of the input names a class. Those are the calls that
 * bring new content in (`loadFile`, `loadModel`, `importFMU`) or change OMC's
 * own state (`setCommandLineOptions`). For most of them nothing they touch has
 * an origin or a file mode to judge yet; `loadString` is the exception, and
 * {@link SOURCE_ARGUMENTS} judges it on the text it carries.
 */
type ClassArgument<K extends OmcFnName> = {
  readonly field: Extract<keyof OmcInput<K>, string>;
  readonly as: "class" | "element";
  readonly action: WriteAction;
} | null;

const edits = <K extends OmcFnName>(
  field: Extract<keyof OmcInput<K>, string>,
): ClassArgument<K> => ({ field, as: "class", action: "edit" });

const createsInside = <K extends OmcFnName>(
  field: Extract<keyof OmcInput<K>, string>,
): ClassArgument<K> => ({ field, as: "class", action: "createInside" });

const editsElement = <K extends OmcFnName>(
  field: Extract<keyof OmcInput<K>, string>,
): ClassArgument<K> => ({ field, as: "element", action: "edit" });

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
  loadFile: null,
  loadFiles: null,
  loadModel: null,
  loadString: null,
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
 * Which argument of `K` carries Modelica text whose own `within` clause and
 * class names choose what the call writes.
 *
 * `loadClassContentString` carries text too, but it names the class it loads
 * into and {@link CLASS_ARGUMENTS} already judges that; the elements it carries
 * do not parse as a stored definition anyway.
 */
type SourceArgument<K extends OmcFnName> = {
  readonly field: Extract<keyof OmcInput<K>, string>;
};

const SOURCE_ARGUMENTS: { readonly [K in "loadString"]: SourceArgument<K> } = {
  loadString: { field: "data" },
};

/**
 * The tables above read by a name only known at runtime, which erases the
 * per-function field-name literals their declarations are checked against.
 */
interface ResolvedClassArgument {
  readonly field: string;
  readonly as: "class" | "element";
  readonly action: WriteAction;
}

const BY_NAME: Readonly<
  Record<string, ResolvedClassArgument | null | undefined>
> = CLASS_ARGUMENTS;

const SOURCE_BY_NAME: Readonly<
  Record<string, { readonly field: string } | undefined>
> = SOURCE_ARGUMENTS;

/**
 * The refusal `fn` earns for `input`, or `undefined` when the call may proceed.
 *
 * Read-only functions, and mutating ones whose input neither names a class nor
 * carries Modelica text, return `undefined` without asking OMC anything.
 */
export async function refusalFor(
  verdicts: WriteVerdictSource,
  client: WriteVerdictClient & SourceParseClient,
  fn: OmcFnName,
  input: unknown,
): Promise<string | undefined> {
  if (typeof input !== "object" || input === null) return undefined;
  const named = input as Record<string, unknown>;

  const source = SOURCE_BY_NAME[fn];
  if (source !== undefined) {
    const refusal = await refusalForSource(
      verdicts,
      client,
      stringField(named, source.field),
    );
    if (refusal !== undefined) return refusal;
  }

  const argument = BY_NAME[fn];
  if (argument === undefined || argument === null) return undefined;

  const raw = stringField(named, argument.field);
  if (raw === "") return undefined;
  const className = argument.as === "element" ? enclosingScope(raw) : raw;

  return refusalForClass(verdicts, client, className, argument.action);
}

/** `field` of `input` when it holds a string, `""` otherwise. */
function stringField(input: Record<string, unknown>, field: string): string {
  const raw: unknown = input[field];
  return typeof raw === "string" ? raw : "";
}

/**
 * The refusal `code` earns for the classes it declares, or `undefined` when
 * every one of them is the caller's to write.
 *
 * A declared class that already exists is being replaced, so it is judged as an
 * edit; one that does not is being added to its `within` scope, so that scope
 * is judged instead. Both questions are asked of every name, because the first
 * fails open for a class OMC cannot resolve — which is exactly the case the
 * second answers.
 *
 * Text OMC cannot parse declares nothing, and the load that follows reports the
 * parse failure with more context than a refusal here could.
 */
async function refusalForSource(
  verdicts: WriteVerdictSource,
  client: WriteVerdictClient & SourceParseClient,
  code: string,
): Promise<string | undefined> {
  if (code === "") return undefined;

  let classNames: string[];
  try {
    ({ classNames } = await client.parseString({ data: code }));
  } catch {
    return undefined;
  }

  for (const className of classNames) {
    const refusal =
      (await refusalForClass(verdicts, client, className, "edit")) ??
      (await refusalForClass(
        verdicts,
        client,
        enclosingScope(className),
        "createInside",
      ));
    if (refusal !== undefined) return refusal;
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
