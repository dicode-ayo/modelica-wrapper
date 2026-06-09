import {
  inheritedComponents,
  qualifyTypeReference,
  walkCrefType,
} from "../../resolve.js";
import {
  CompletionCandidateKind,
  type CompletionCandidate,
} from "../candidate.js";
import type { CompletionClient } from "../client.js";
import { tryCall } from "../merge.js";

/**
 * Member access after `.`: resolve the head path's type with the resolution
 * layer's shared component-type walk, then offer that type's components. If the
 * head resolves to a PACKAGE rather than a component type, offer its nested
 * class names instead (`Modelica.Electrical.|` → the package's children).
 *
 * The head can be a component path (`r` → its type's members) or a dotted
 * package/class name. We try the component-type walk first; if it yields no
 * type, we treat the head as a qualified class name and probe whether it is a
 * package.
 */
export async function memberCandidates(
  owningClass: string,
  head: readonly string[],
  client: CompletionClient,
): Promise<CompletionCandidate[]> {
  if (head.length === 0) return [];

  // 1) Component path: walk the head segments to a component type, then list its
  //    members. Reuses `walkCrefType` — the SAME walk `resolve.ts` uses.
  const componentType = await walkCrefType(owningClass, head, client);
  if (componentType) {
    return memberComponents(componentType, client);
  }

  // 2) Package / class path: qualify the dotted head in scope and, if it names a
  //    package, offer its nested classes.
  const qualified = await qualifyTypeReference(owningClass, head, client);
  if (qualified) {
    const candidates = await packageClassCandidates(qualified, client);
    if (candidates.length > 0) return candidates;
  }

  return [];
}

/**
 * Members of `typeName`, as Field candidates with their type — the
 * inheritance-inclusive list (own components plus those pulled in through
 * `extends`, transitively), so MSL types whose members are mostly inherited
 * surface them all.
 */
async function memberComponents(
  typeName: string,
  client: CompletionClient,
): Promise<CompletionCandidate[]> {
  const components = await inheritedComponents(typeName, client);
  return components.map((c) => {
    const candidate: CompletionCandidate = {
      label: c.name,
      kind: CompletionCandidateKind.Field,
    };
    // Only attach `detail` when there's a type to show; `exactOptionalPropertyTypes`
    // forbids assigning `undefined` to the optional field.
    return c.className.length > 0
      ? { ...candidate, detail: c.className }
      : candidate;
  });
}

/**
 * Nested class names of `qualifiedName` when it is a package, as Class
 * candidates. Returns empty when `qualifiedName` is not a package (so the caller
 * doesn't mistake a non-package's empty list for "package with no children").
 */
async function packageClassCandidates(
  qualifiedName: string,
  client: CompletionClient,
): Promise<CompletionCandidate[]> {
  const { b: isPkg } = await tryCall(
    "isPackage",
    () => client.isPackage({ typeName: qualifiedName }),
    { b: false },
  );
  if (!isPkg) return [];

  const { classNames } = await tryCall(
    "package getClassNames",
    () => client.getClassNames({ typeName: qualifiedName }),
    { classNames: [] },
  );
  return classNames.map((name) => ({
    label: name,
    kind: CompletionCandidateKind.Class,
  }));
}
