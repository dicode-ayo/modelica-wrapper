/**
 * Semantic resolution: `(owningClass, cursor target) → ResolvedTarget`.
 *
 *   - Class/type reference (`type-reference`, `extends`, `component-type`):
 *     `qualifyPath` against `owningClass`, then `getClassInformation` as the
 *     existence probe.
 *   - Member cref (`member-access`, `a.b.c`): walk segments via `getComponents`
 *     — each segment resolves in the *previous* segment's type. The resolved
 *     target is the final member's declared type.
 *
 * Returns `undefined` rather than guessing on any failure.
 */

import { log } from "../logger.js";

import type { CursorContextKind, CursorTarget } from "./cursor.js";

/** The slice of {@link CursorTarget} the resolver reads. */
export type ResolveTarget = Pick<CursorTarget, "context" | "pathToCursor">;

/** Qualifies a name into a fully-qualified class path within a scope. */
export interface QualifyClient {
  qualifyPath(input: {
    typeName: string;
    path: string;
  }): Promise<{ qualifiedPath: string }>;
}

/** Lists a class's declared components, for the cref type-walk. */
export interface ComponentWalkClient {
  getComponents(input: { typeName: string }): Promise<{
    components: { className: string; name: string }[];
  }>;
}

/** Structural OMC surface; `OmcClient` satisfies this so tests can pass a mock. */
export interface ResolveClient extends QualifyClient, ComponentWalkClient {
  getClassInformation(input: { typeName: string }): Promise<{ fileName: string }>;
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
  const qualifiedPath = await qualifyTypeReference(
    owningClass,
    target.pathToCursor,
    client,
  );
  if (qualifiedPath === undefined) return undefined;
  // A top-level name qualifies to itself rather than to `undefined`, so we still
  // attempt `getClassInformation` and treat a missing source binding as
  // unresolved.
  return locateClass(qualifiedPath, client);
}

/**
 * Qualify a dotted name in `owningClass`'s scope into a fully-qualified class
 * name (honouring `import`/`extends`), or `undefined` for an empty path or a
 * rejected lookup. OMC returns the name unchanged when it cannot qualify it;
 * that's still the caller's existence probe via `getClassInformation`, not a
 * failure here.
 */
export async function qualifyTypeReference(
  owningClass: string,
  pathToCursor: readonly string[],
  client: QualifyClient,
): Promise<string | undefined> {
  const name = pathToCursor.join(".");
  if (name.length === 0) return undefined;
  try {
    const { qualifiedPath } = await client.qualifyPath({
      typeName: owningClass,
      path: name,
    });
    return qualifiedPath;
  } catch (err) {
    // OMC can throw on a malformed/partially-typed name or an unloaded scope.
    // Treat it as "couldn't qualify" so the resolver (and the completion source
    // that shares this helper) degrades to no result instead of throwing out.
    log.debug("language", `qualifyPath failed for ${name}`, err);
    return undefined;
  }
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

  // Walk against the previous segment's type so `a.b.c` visits `b` in `a`'s
  // type and `c` in `b`'s type — not `c` in `a`'s type.
  const containerType = await walkCrefType(owningClass, chain, client);
  if (!containerType) return undefined;

  const memberType = await resolveComponentType(
    containerType,
    memberName,
    client,
  );
  if (!memberType) return undefined;

  return locateClass(memberType, client);
}

/**
 * Walk a dotted component path against `owningClass`'s scope to the
 * fully-qualified type of its final segment. Each segment resolves in the
 * *previous* segment's type. Returns `undefined` for an empty path or when any
 * segment can't be walked.
 */
export async function walkCrefType(
  owningClass: string,
  segments: readonly string[],
  client: ComponentWalkClient,
): Promise<string | undefined> {
  if (segments.length === 0) return undefined;
  let containerType = owningClass;
  for (const segment of segments) {
    const next = await resolveComponentType(containerType, segment, client);
    if (!next) return undefined;
    containerType = next;
  }
  return containerType;
}

async function resolveComponentType(
  containerType: string,
  componentName: string,
  client: ComponentWalkClient,
): Promise<string | undefined> {
  let components;
  try {
    ({ components } = await client.getComponents({ typeName: containerType }));
  } catch (err) {
    log.debug("language", `getComponents failed for ${containerType}`, err);
    return undefined;
  }
  const className = components.find((c) => c.name === componentName)?.className;
  // Empty className means untyped declaration; treat as unresolved.
  return className !== undefined && className.length > 0 ? className : undefined;
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
  } catch (err) {
    log.debug("language", `getClassInformation failed for ${qualifiedName}`, err);
    return undefined;
  }
  // Empty fileName = built-in / unbound class.
  if (info.fileName.length === 0) return undefined;
  return { qualifiedName };
}
