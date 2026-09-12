/**
 * Declaring a new class into OMC's symbol table.
 *
 * `newModel` is the primitive OMC offers, and it only makes a `model`, only
 * inside an existing package. `loadString` under a `within` clause is what
 * every other restriction and every top-level class needs, and it is what
 * OMEdit's `createClass`/`createSubClass` send.
 *
 * The class is bound to a `<runtime:…>` placeholder rather than a path: it has
 * no file until one is written for it, and naming a real path here would claim
 * a file nothing has written. {@link persistClass} is the other half.
 */

/** The OMC surface a declaration needs. `OmcClient` satisfies it. */
export interface DeclareClient {
  loadString(input: {
    data: string;
    filename: string;
    merge: boolean;
  }): Promise<{ success: boolean }>;
  getErrorString(): Promise<{ errorString: string }>;
}

/**
 * Every restriction OMEdit's New Class dialog offers. All of them load as an
 * empty class, the multi-word ones included.
 */
export const CLASS_KINDS = [
  "model",
  "package",
  "block",
  "connector",
  "expandable connector",
  "function",
  "record",
  "type",
  "class",
  "operator",
  "operator record",
  "operator function",
] as const;

export type ClassKind = (typeof CLASS_KINDS)[number];

export interface ClassDeclaration {
  /** The class's own name, not the dotted path. */
  readonly name: string;
  readonly kind: ClassKind;
  /** The package to declare it inside; absent for a top-level class. */
  readonly withinPath?: string | undefined;
  readonly extendsFrom?: string | undefined;
}

/** The dotted name `declaration` will be known by once it is loaded. */
export function qualifiedNameOf(declaration: ClassDeclaration): string {
  const { name, withinPath } = declaration;
  return withinPath === undefined ? name : `${withinPath}.${name}`;
}

/** The Modelica source text for `declaration`, `within` clause included. */
export function classSource(declaration: ClassDeclaration): string {
  const { name, kind, withinPath, extendsFrom } = declaration;
  const header = withinPath === undefined ? "" : `within ${withinPath};\n`;
  const base = extendsFrom === undefined ? "" : `  extends ${extendsFrom};\n`;
  return `${header}${kind} ${name}\n${base}end ${name};\n`;
}

/**
 * Load `declaration` into OMC, reporting OMC's own reason when it will not
 * take it.
 *
 * `success` is false for a class OMC refused and for one whose `within` target
 * it could not find, and the reason for either only lives in `getErrorString`.
 */
export async function declareClass(
  client: DeclareClient,
  declaration: ClassDeclaration,
): Promise<{ ok: true; source: string } | { ok: false; reason: string }> {
  const qualifiedName = qualifiedNameOf(declaration);
  const source = classSource(declaration);
  const { success } = await client.loadString({
    data: source,
    filename: `<runtime:${qualifiedName}>`,
    merge: true,
  });
  if (success) return { ok: true, source };
  const { errorString } = await client.getErrorString();
  return {
    ok: false,
    reason:
      errorString === ""
        ? `OMC refused to create ${qualifiedName}`
        : errorString,
  };
}

/** OMC surface {@link resolveRootPackageParent} needs. `OmcClient` satisfies it. */
export interface RootPackageClient {
  parseFile(input: { fileName: string }): Promise<{ classNames: string[] }>;
  getClassInformation(input: {
    typeName: string;
  }): Promise<{ restriction: string }>;
}

/**
 * The class `rootPkg` (an already-confirmed `<root>/package.mo`) declares — the
 * one destination a new class can mean once the source tree's root is itself a
 * package. A class written beside that `package.mo` without a `within` clause
 * naming it makes OMC refuse the whole package, not just the new file.
 *
 * Refuses rather than guessing when the file doesn't parse to exactly one
 * top-level class, or when that class isn't loaded into OMC yet: `parseFile`
 * only reads the file off disk, so it can parse cleanly while the symbol table
 * is still empty, and the `within` merge that follows would fail against it.
 *
 * The load check only confirms a class named `name` is loaded, not that it is
 * specifically the one `rootPkg` declares — a same-named class loaded from
 * elsewhere would pass it too.
 */
export async function resolveRootPackageParent(
  client: RootPackageClient,
  rootPkg: string,
): Promise<{ ok: true; parent: string } | { ok: false; reason: string }> {
  let classNames: string[];
  try {
    ({ classNames } = await client.parseFile({ fileName: rootPkg }));
  } catch (err) {
    return {
      ok: false,
      reason: `could not read ${rootPkg}'s class name (${detail(err)})`,
    };
  }
  if (classNames.length > 1) {
    return {
      ok: false,
      reason: `${rootPkg} declares more than one top-level class (${classNames.join(", ")})`,
    };
  }
  const [name] = classNames;
  if (name === undefined) {
    return {
      ok: false,
      reason: `${rootPkg} declares no class OMC could parse`,
    };
  }
  try {
    const info = await client.getClassInformation({ typeName: name });
    // A not-yet-loaded class doesn't reject — OMC 1.27.0 answers with every
    // field defaulted (empty `restriction` among them) rather than an error
    // (see packages/omc-client/src/api/browsing/getClassInformation.test.ts's
    // `NOT_FOUND_18` fixture). Every real class restriction (model, package,
    // block, …) is non-empty, so that's the signal to key off instead of a
    // thrown rejection.
    if (info.restriction === "") {
      return {
        ok: false,
        reason: `no class named ${name} is loaded into OMC yet — wait for the workspace to finish loading and try again`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: `could not confirm ${name} is loaded into OMC (${detail(err)})`,
    };
  }
  return { ok: true, parent: name };
}

function detail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
