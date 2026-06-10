/**
 * Semantic resolution: `(owningClass, cursor target) → ResolvedTarget`.
 *
 *   - Class/type reference (`type-reference`, `extends`, `component-type`):
 *     `qualifyPath` against `owningClass`, then `getClassInformation` as the
 *     existence probe.
 *   - Member cref (`member-access`, `a.b.c`): walk segments via the
 *     inheritance-inclusive component list — each segment resolves in the
 *     *previous* segment's type, including members pulled in through `extends`.
 *     The resolved target is the final member's declared type.
 *
 * Returns `undefined` rather than guessing on any failure.
 */

import type { CursorContextKind, CursorTarget } from "./cursor.js";
import { noopLogger, type Logger } from "./logger.js";

/** The slice of {@link CursorTarget} the resolver reads. */
export type ResolveTarget = Pick<CursorTarget, "context" | "pathToCursor">;

/** Qualifies a name into a fully-qualified class path within a scope. */
export interface QualifyClient {
  qualifyPath(input: {
    typeName: string;
    path: string;
  }): Promise<{ qualifiedPath: string }>;
}

/**
 * Lists a class's direct `extends` base classes — the inheritance step both
 * walks share.
 */
export interface InheritedClassesClient {
  getInheritedClasses(input: {
    typeName: string;
  }): Promise<{ inheritedClasses: string[] }>;
}

/**
 * Lists a class's components and its `extends` bases, for the
 * inheritance-inclusive cref type-walk. `getComponents` reports a class's *own*
 * declared components; `getInheritedClasses` reports its direct base classes, so
 * the union across the transitive base set is the full member list.
 */
export interface ComponentWalkClient extends InheritedClassesClient {
  getComponents(input: { typeName: string }): Promise<{
    components: { className: string; name: string }[];
  }>;
}

/** Structural OMC surface; `OmcClient` satisfies this so tests can pass a mock. */
export interface ResolveClient extends QualifyClient, ComponentWalkClient {
  getClassInformation(input: {
    typeName: string;
  }): Promise<{ fileName: string }>;
}

/** A resolved definition target. */
export interface ResolvedTarget {
  readonly qualifiedName: string;
}

const TYPE_CONTEXTS: ReadonlySet<CursorContextKind> =
  new Set<CursorContextKind>(["type-reference", "extends", "component-type"]);

export async function resolve(
  owningClass: string,
  target: ResolveTarget,
  client: ResolveClient,
  logger: Logger = noopLogger,
): Promise<ResolvedTarget | undefined> {
  if (target.context === "member-access") {
    return resolveMemberCref(owningClass, target, client, logger);
  }
  if (TYPE_CONTEXTS.has(target.context)) {
    return resolveTypeReference(owningClass, target, client, logger);
  }
  return undefined;
}

async function resolveTypeReference(
  owningClass: string,
  target: ResolveTarget,
  client: ResolveClient,
  logger: Logger,
): Promise<ResolvedTarget | undefined> {
  const qualifiedPath = await qualifyTypeReference(
    owningClass,
    target.pathToCursor,
    client,
    logger,
  );
  if (qualifiedPath === undefined) return undefined;
  // A top-level name qualifies to itself rather than to `undefined`, so we still
  // attempt `getClassInformation` and treat a missing source binding as
  // unresolved.
  return locateClass(qualifiedPath, client, logger);
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
  logger: Logger = noopLogger,
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
    logger.debug("language", `qualifyPath failed for ${name}`, err);
    return undefined;
  }
}

async function resolveMemberCref(
  owningClass: string,
  target: ResolveTarget,
  client: ResolveClient,
  logger: Logger,
): Promise<ResolvedTarget | undefined> {
  const segments = target.pathToCursor;
  if (segments.length < 2) return undefined;

  // `noUncheckedIndexedAccess` blocks index-after-length-check narrowing.
  const memberName = segments.at(-1);
  if (memberName === undefined) return undefined;
  const chain = segments.slice(0, -1);

  // Walk against the previous segment's type so `a.b.c` visits `b` in `a`'s
  // type and `c` in `b`'s type — not `c` in `a`'s type.
  const containerType = await walkCrefType(owningClass, chain, client, logger);
  if (!containerType) return undefined;

  const memberType = await resolveComponentType(
    containerType,
    memberName,
    client,
    logger,
  );
  if (!memberType) return undefined;

  return locateClass(memberType, client, logger);
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
  logger: Logger = noopLogger,
): Promise<string | undefined> {
  if (segments.length === 0) return undefined;
  let containerType = owningClass;
  for (const segment of segments) {
    const next = await resolveComponentType(
      containerType,
      segment,
      client,
      logger,
    );
    if (!next) return undefined;
    containerType = next;
  }
  return containerType;
}

async function resolveComponentType(
  containerType: string,
  componentName: string,
  client: ComponentWalkClient,
  logger: Logger,
): Promise<string | undefined> {
  const components = await inheritedComponents(containerType, client, logger);
  const className = components.find((c) => c.name === componentName)?.className;
  // Empty className means untyped declaration; treat as unresolved.
  return className !== undefined && className.length > 0
    ? className
    : undefined;
}

/** A component as reported by `getComponents`, narrowed to what callers read. */
export interface WalkedComponent {
  readonly name: string;
  readonly className: string;
}

/**
 * The inheritance-inclusive component list of `typeName`: its own declared
 * components unioned with those of every transitive `extends` base. Own/nearer
 * declarations win over inherited ones with the same name (Modelica shadowing),
 * so the result is de-duped by component name keeping the first occurrence in a
 * breadth-first walk from `typeName` outward through its bases.
 *
 * A failed `getComponents`/`getInheritedClasses` for any class contributes
 * nothing rather than aborting the walk.
 */
export async function inheritedComponents(
  typeName: string,
  client: ComponentWalkClient,
  logger: Logger = noopLogger,
): Promise<WalkedComponent[]> {
  const byName = new Map<string, WalkedComponent>();
  const visited = new Set<string>();
  // Breadth-first from `typeName` outward so a nearer declaration is seen before
  // a more-distant inherited one and therefore wins the de-dupe.
  const queue: string[] = [typeName];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);

    const [components, bases] = await Promise.all([
      ownComponents(current, client, logger),
      directBases(current, client, logger),
    ]);
    for (const c of components) {
      if (!byName.has(c.name)) byName.set(c.name, c);
    }
    for (const base of bases) {
      if (!visited.has(base)) queue.push(base);
    }
  }

  return [...byName.values()];
}

/**
 * Lists a class's own parameters and its `extends` bases, for the
 * inheritance-inclusive parameter walk. `getParameterNames` reports a class's
 * *own* declared parameters — it DROPS those a base class contributes — so the
 * union across the transitive base set is the full parameter list.
 */
export interface ParameterWalkClient extends InheritedClassesClient {
  getParameterNames(input: { typeName: string }): Promise<{
    parameters: string[];
  }>;
}

/**
 * The inheritance-inclusive parameter names of `typeName`: its own declared
 * parameters unioned with those of every transitive `extends` base, in
 * breadth-first order from `typeName` outward and de-duped by name (a nearer
 * declaration is seen first and kept). The walk is cycle-guarded; a failed
 * `getParameterNames`/`getInheritedClasses` for any class contributes nothing
 * rather than aborting.
 *
 * `getParameterNames` alone reports only a class's OWN parameters (a type whose
 * conditional ports/params descend from a base — e.g. `useHeatPort` via
 * `ConditionalHeatPort` — would lose them), so the base-class union is what
 * surfaces inherited parameters.
 */
export async function inheritedParameterNames(
  typeName: string,
  client: ParameterWalkClient,
  logger: Logger = noopLogger,
): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [typeName];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);

    const [params, bases] = await Promise.all([
      ownParameters(current, client, logger),
      directBases(current, client, logger),
    ]);
    for (const name of params) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
    for (const base of bases) {
      if (!visited.has(base)) queue.push(base);
    }
  }

  return out;
}

async function ownParameters(
  typeName: string,
  client: ParameterWalkClient,
  logger: Logger,
): Promise<string[]> {
  try {
    const { parameters } = await client.getParameterNames({ typeName });
    return parameters;
  } catch (err) {
    logger.debug("language", `getParameterNames failed for ${typeName}`, err);
    return [];
  }
}

async function ownComponents(
  typeName: string,
  client: ComponentWalkClient,
  logger: Logger,
): Promise<WalkedComponent[]> {
  try {
    const { components } = await client.getComponents({ typeName });
    return components;
  } catch (err) {
    logger.debug("language", `getComponents failed for ${typeName}`, err);
    return [];
  }
}

async function directBases(
  typeName: string,
  client: InheritedClassesClient,
  logger: Logger,
): Promise<string[]> {
  try {
    const { inheritedClasses } = await client.getInheritedClasses({ typeName });
    return inheritedClasses;
  } catch (err) {
    logger.debug("language", `getInheritedClasses failed for ${typeName}`, err);
    return [];
  }
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
  logger: Logger,
): Promise<ResolvedTarget | undefined> {
  if (qualifiedName.length === 0) return undefined;
  let info;
  try {
    info = await client.getClassInformation({ typeName: qualifiedName });
  } catch (err) {
    logger.debug(
      "language",
      `getClassInformation failed for ${qualifiedName}`,
      err,
    );
    return undefined;
  }
  // Empty fileName = built-in / unbound class.
  if (info.fileName.length === 0) return undefined;
  return { qualifiedName };
}
