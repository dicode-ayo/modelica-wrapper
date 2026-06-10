import {
  inheritedParameterNames,
  noopLogger,
  qualifyTypeReference,
  walkCrefType,
  type Logger,
  type ModifiedType,
} from "@dicode/modelica-lang-core";

import {
  CompletionCandidateKind,
  type CompletionCandidate,
} from "../candidate.js";
import type { CompletionClient } from "../client.js";

/**
 * Class-modification position: the parameters of the class being modified,
 * INCLUDING inherited ones. The declaration's *type* (`modified.type`) is
 * qualified in the owning class's scope, then `modified.path` is walked through
 * the inheritance-inclusive component lists — each segment resolves to a
 * sub-component's type in the previous type — so a nested modifier
 * (`Motor m(resistor(|))`) lists the inner `resistor`'s parameters, not the
 * outer `Motor`'s. An empty path lists the qualified type's parameters directly.
 * A segment that doesn't resolve yields no candidates.
 *
 * `getParameterNames` reports only a class's OWN parameters, so the list is the
 * inheritance-inclusive union over the innermost type's `extends` bases (mirrors
 * the member-access component walk).
 */
export async function modifierCandidates(
  owningClass: string,
  modified: ModifiedType,
  client: CompletionClient,
  logger: Logger = noopLogger,
): Promise<CompletionCandidate[]> {
  // Qualify the declared type in scope so the parameter lookups get the
  // fully-qualified class (a short `Resistor` won't resolve on its own).
  const qualified =
    (await qualifyTypeReference(
      owningClass,
      [modified.type],
      client,
      logger,
    )) ?? modified.type;

  const innermost =
    modified.path.length === 0
      ? qualified
      : await walkCrefType(qualified, modified.path, client, logger);
  if (innermost === undefined) return [];

  const parameters = await inheritedParameterNames(innermost, client, logger);
  return parameters.map((name) => ({
    label: name,
    kind: CompletionCandidateKind.Property,
  }));
}
