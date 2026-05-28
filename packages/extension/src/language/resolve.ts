/**
 * Semantic resolution — the hard half of the hybrid loop.
 *
 * Given the *syntactic* facts the cursor classifier (`cursor.ts`) extracts — an
 * identifier, the dotted path it belongs to, and its context kind — plus the
 * *owning class* of the document (`owning-class.ts`), this turns a name into a
 * resolved target and its source location, using OMC as the Modelica scope
 * engine. It is the back-end of `definition-provider.ts` / `hover-provider.ts`
 * (#97), which build a `vscode.Location` / `vscode.Hover` from the result.
 *
 * Two resolution strategies, selected by the cursor context:
 *
 *   - **Class / type reference** (`type-reference`, `extends`, `component-type`)
 *     — qualify the name in the owning class's scope with
 *     [`qualifyPath`](../../../omc-client/src/api/contents/qualifyPath.ts)
 *     (honours `import` + `extends`), then read the definition location with
 *     [`getClassInformation`](../../../omc-client/src/api/browsing/getClassInformation.ts).
 *
 *   - **Member cref** (`member-access`, e.g. `resistor.R` or `a.b.c`) — walk the
 *     dotted path one segment at a time with
 *     [`getComponents`](../../../omc-client/src/api/contents/getComponents.ts):
 *     resolve the first segment's type in the owning class, then resolve each
 *     subsequent segment against the *previous segment's* type. The final
 *     segment is the member; its declared type's definition is the navigable
 *     target. A segment that can't be walked yields *unresolved* rather than a
 *     wrong answer.
 *
 * Only typed `@dicode/omc-client` wrappers are used — never raw `client.call`.
 * The OMC surface is the structural {@link ResolveClient} so the resolver is
 * unit-testable with a plain mock (mirrors `diagram/omc-snapshot.ts`); a real
 * `OmcClient` satisfies it.
 *
 * ## Coordinates
 *
 * OMC reports 1-based line AND column; the returned `line`/`column` here are
 * **0-based** (VSCode), converted through the single helper in `position.ts`.
 */

import type { CursorContextKind, CursorTarget } from "./cursor.js";
import { omcToVscodePosition } from "./position.js";

/**
 * The OMC calls the resolver makes, as a structural surface so it can be mocked
 * in tests. `OmcClient` satisfies this, so real call sites pass it unchanged.
 */
export interface ResolveClient {
  qualifyPath(input: {
    typeName: string;
    path: string;
  }): Promise<{ qualifiedPath: string }>;
  getClassInformation(input: { typeName: string }): Promise<{
    fileName: string;
    lineNumberStart: number;
    columnNumberStart: number;
  }>;
  getComponents(input: { typeName: string }): Promise<{
    components: { className: string; name: string }[];
  }>;
}

/** A resolved definition target with its 0-based source location. */
export interface ResolvedTarget {
  /** Fully-qualified Modelica name of the resolved entity. */
  readonly qualifiedName: string;
  /** Source file the definition lives in (OMC `fileName`). */
  readonly fileName: string;
  /** 0-based line of the definition (converted from OMC's 1-based). */
  readonly line: number;
  /** 0-based column of the definition (converted from OMC's 1-based). */
  readonly column: number;
}

/** Context kinds that resolve to a class/type definition. */
const TYPE_CONTEXTS: ReadonlySet<CursorContextKind> = new Set<CursorContextKind>(
  ["type-reference", "extends", "component-type"],
);

/**
 * Resolve a classified cursor target to its definition + location, in the scope
 * of `owningClass`. Returns `undefined` when the name cannot be resolved (OMC
 * couldn't qualify it, the class/component is unknown, or the context is not
 * resolvable in v1 — e.g. a plain value reference or a modifier value).
 *
 * @param owningClass - fully-qualified name of the class the document defines
 *   (from `owning-class.ts`); the scope `qualifyPath` resolves against.
 * @param target - the cursor target from `cursor.ts` (identifier + dotted path
 *   + context).
 * @param client - structural OMC surface (a real `OmcClient` works).
 */
export async function resolve(
  owningClass: string,
  target: CursorTarget,
  client: ResolveClient,
): Promise<ResolvedTarget | undefined> {
  if (target.context === "member-access") {
    return resolveMemberCref(owningClass, target, client);
  }
  if (TYPE_CONTEXTS.has(target.context)) {
    return resolveTypeReference(owningClass, target, client);
  }
  // `component-reference`, `modifier-name`, `unknown`: a bare value reference or
  // a modifier name doesn't resolve to a class definition in v1. (A single
  // class-like name still arrives here as `type-reference`/`component-type`.)
  return undefined;
}

/**
 * Class/type reference: qualify the dotted path up to the cursor in the owning
 * class's scope, then read the qualified class's definition location.
 */
async function resolveTypeReference(
  owningClass: string,
  target: CursorTarget,
  client: ResolveClient,
): Promise<ResolvedTarget | undefined> {
  const name = target.pathToCursor.join(".");
  if (name.length === 0) return undefined;

  const { qualifiedPath } = await client.qualifyPath({
    typeName: owningClass,
    path: name,
  });
  // OMC returns the name unchanged when it cannot qualify it; that is not
  // necessarily a failure (a top-level name qualifies to itself), so we try
  // getClassInformation regardless and treat a missing location as unresolved.
  return locateClass(qualifiedPath, client);
}

/**
 * Member cref (`a.b.c`): walk the dotted path one segment at a time. The first
 * segment resolves in the owning class; each subsequent segment resolves in the
 * *previous* segment's type, so `a.b.c` correctly visits `b` in `a`'s type and
 * `c` in `b`'s type (not `c` in `a`'s type). Any segment that can't be walked —
 * an unknown component or a type with no `getComponents` answer — returns
 * `undefined` rather than a wrong answer.
 *
 * Inherited members are a known v1 gap: `getComponents` reports only a class's
 * *own* declared components, not those pulled in by `extends`, so a member
 * inherited from a base class resolves to `undefined`. Inheritance walking is
 * listed as a v1 limitation in `docs/language-features-design.md`.
 *
 * The resolved location is the **final member's declared type** definition — OMC
 * does not expose a per-component source line through `getComponents`, so the
 * type definition is the navigable target we can produce without an AST walk.
 * The returned `qualifiedName` is `<containerType>.<member>` so callers can show
 * what was resolved. Refining to the member's exact declaration line is a
 * follow-up.
 */
async function resolveMemberCref(
  owningClass: string,
  target: CursorTarget,
  client: ResolveClient,
): Promise<ResolvedTarget | undefined> {
  // pathToCursor is e.g. ["a", "b", "c"]: the leading segments are components
  // walked through their types; the last segment is the member under the cursor.
  const segments = target.pathToCursor;
  if (segments.length < 2) return undefined;

  // `segments.length >= 2` guarantees both `chain` is non-empty and `memberName`
  // exists, so the destructure tail is safe without non-null assertions.
  const memberName = segments[segments.length - 1] as string;
  const chain = segments.slice(0, -1);

  // Walk every chain segment against the previous segment's type, so the
  // container type for the member is the type of the second-to-last segment.
  let containerType = owningClass;
  for (const segment of chain) {
    const next = await resolveComponentType(containerType, segment, client);
    if (!next) return undefined;
    containerType = next;
  }

  const memberType = await resolveComponentType(
    containerType,
    memberName,
    client,
  );
  if (!memberType) return undefined;

  const location = await locateClass(memberType, client);
  if (!location) return undefined;
  return {
    qualifiedName: `${containerType}.${memberName}`,
    fileName: location.fileName,
    line: location.line,
    column: location.column,
  };
}

/**
 * The declared type (fully-qualified) of the component named `componentName`
 * inside `containerType`, or `undefined` if no such component exists. The type
 * `getComponents` reports for a component is already qualified by OMC.
 */
async function resolveComponentType(
  containerType: string,
  componentName: string,
  client: ResolveClient,
): Promise<string | undefined> {
  let components;
  try {
    ({ components } = await client.getComponents({ typeName: containerType }));
  } catch {
    return undefined;
  }
  const match = components.find((c) => c.name === componentName);
  return match?.className && match.className.length > 0
    ? match.className
    : undefined;
}

/**
 * Read a class's definition location via `getClassInformation`, converting the
 * OMC 1-based coordinates to 0-based. Returns `undefined` when OMC reports no
 * file (an unknown/built-in class with no source binding) or the call fails.
 */
async function locateClass(
  qualifiedName: string,
  client: ResolveClient,
): Promise<ResolvedTarget | undefined> {
  if (qualifiedName.length === 0) return undefined;
  let info;
  try {
    info = await client.getClassInformation({ typeName: qualifiedName });
  } catch {
    return undefined;
  }
  if (info.fileName.length === 0) return undefined;
  const { line, character } = omcToVscodePosition(
    info.lineNumberStart,
    info.columnNumberStart,
  );
  return {
    qualifiedName,
    fileName: info.fileName,
    line,
    column: character,
  };
}
