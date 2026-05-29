/**
 * Semantic resolution: `(owningClass, cursor target) → ResolvedTarget`.
 *
 *   - Class/type reference (`type-reference`, `extends`, `component-type`):
 *     `qualifyPath` against `owningClass`, then `getClassInformation` for the
 *     definition location.
 *   - Member cref (`member-access`, `a.b.c`): walk segments via `getComponents`
 *     — each segment resolves in the *previous* segment's type. Resolved
 *     location is the final member's declared type definition (OMC does not
 *     expose per-component source lines).
 *
 * Returns `undefined` rather than guessing on any failure.
 */

import type { CursorContextKind, CursorTarget } from "./cursor.js";

/** The slice of {@link CursorTarget} the resolver reads. */
export type ResolveTarget = Pick<CursorTarget, "context" | "pathToCursor">;

/** Structural OMC surface; `OmcClient` satisfies this so tests can pass a mock. */
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

/** A resolved definition target. */
export interface ResolvedTarget {
  readonly qualifiedName: string;
}

const TYPE_CONTEXTS: ReadonlySet<CursorContextKind> = new Set<CursorContextKind>(
  ["type-reference", "extends", "component-type"],
);

export async function resolve(
  owningClass: string,
  target: ResolveTarget,
  client: ResolveClient,
): Promise<ResolvedTarget | undefined> {
  if (target.context === "member-access") {
    return resolveMemberCref(owningClass, target, client);
  }
  if (TYPE_CONTEXTS.has(target.context)) {
    return resolveTypeReference(owningClass, target, client);
  }
  return undefined;
}

async function resolveTypeReference(
  owningClass: string,
  target: ResolveTarget,
  client: ResolveClient,
): Promise<ResolvedTarget | undefined> {
  const name = target.pathToCursor.join(".");
  if (name.length === 0) return undefined;

  let qualifiedPath: string;
  try {
    ({ qualifiedPath } = await client.qualifyPath({
      typeName: owningClass,
      path: name,
    }));
  } catch {
    return undefined;
  }
  // OMC echoes the name when it cannot qualify it; top-level names qualify to
  // themselves, so let `getClassInformation` arbitrate via missing fileName.
  return locateClass(qualifiedPath, client);
}

async function resolveMemberCref(
  owningClass: string,
  target: ResolveTarget,
  client: ResolveClient,
): Promise<ResolvedTarget | undefined> {
  const segments = target.pathToCursor;
  if (segments.length < 2) return undefined;

  // `noUncheckedIndexedAccess` blocks index-after-length-check narrowing.
  const memberName = segments.at(-1);
  if (memberName === undefined) return undefined;
  const chain = segments.slice(0, -1);

  // Walking against the previous segment's type makes `a.b.c` visit `b` in
  // `a`'s type and `c` in `b`'s type — not `c` in `a`'s type.
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

  return locateClass(memberType, client);
}

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
  const className = components.find((c) => c.name === componentName)?.className;
  // Empty className means untyped declaration; treat as unresolved.
  return className && className.length > 0 ? className : undefined;
}

/**
 * Verify that `qualifiedName` names a real class — an unknown or built-in name
 * (no source binding) yields `undefined`, otherwise the FQN comes back wrapped
 * in a {@link ResolvedTarget}. `getClassInformation` is the existence probe;
 * its location coordinates are not read.
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
  // Empty fileName = built-in / unbound class.
  if (info.fileName.length === 0) return undefined;
  return { qualifiedName };
}
