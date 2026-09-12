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

export const CLASS_KINDS = [
  "model",
  "package",
  "block",
  "connector",
  "function",
  "record",
  "type",
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
  return withinPath === undefined || withinPath === ""
    ? name
    : `${withinPath}.${name}`;
}

/** The Modelica source text for `declaration`, `within` clause included. */
export function classSource(declaration: ClassDeclaration): string {
  const { name, kind, withinPath, extendsFrom } = declaration;
  const header =
    withinPath === undefined || withinPath === ""
      ? ""
      : `within ${withinPath};\n`;
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
