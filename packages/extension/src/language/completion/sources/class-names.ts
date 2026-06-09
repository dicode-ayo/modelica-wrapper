import { log } from "../../../logger.js";
import {
  builtInTypeCandidates,
  keywordCandidates,
  snippetCandidates,
} from "../../static-candidates.js";
import {
  CompletionCandidateKind,
  MIN_FUZZY_PREFIX,
  type CompletionCandidate,
  type CompletionResult,
} from "../candidate.js";
import type { CompletionClient } from "../client.js";
import { cap, tryCall } from "../merge.js";

/** Class-name candidates plus whether the fuzzy global net was queried. */
interface ClassNameResult {
  readonly candidates: CompletionCandidate[];
  readonly firedFuzzyNet: boolean;
}

/**
 * Type/class-name position result: the OMC class names for `prefix` merged with
 * the static built-in types, and — when `withStatementChannels` — the keyword
 * and snippet channels. `cap` bounds only the unbounded OMC names; the fixed
 * static set is merged after. A built-in type whose label already came from the
 * OMC names is dropped so the label appears once; keyword and snippet channels
 * may share a label (e.g. `model`) and are both kept.
 *
 * Incomplete only when the fuzzy global net fired (see {@link CompletionResult}).
 */
export async function typePositionCandidates(
  owningClass: string,
  prefix: string,
  withStatementChannels: boolean,
  client: CompletionClient,
): Promise<CompletionResult> {
  const names = await classNameCandidates(owningClass, prefix, client);
  const omcNames = cap(names.candidates);
  const omcLabels = new Set(omcNames.map((c) => c.label));
  const statics = builtInTypeCandidates().filter(
    (c) => !omcLabels.has(c.label),
  );
  if (withStatementChannels) {
    statics.push(...keywordCandidates(), ...snippetCandidates());
  }
  return {
    candidates: [...omcNames, ...statics],
    isIncomplete: names.firedFuzzyNet,
  };
}

/**
 * The owning class followed by each enclosing scope, nearest first, by stripping
 * one trailing dotted segment at a time (`A.B.C` -> `A.B.C`, `A.B`, `A`). The
 * top-level scope (the empty name) is omitted: `getClassNames` with no
 * `typeName` lists every top-level package, which the fuzzy global search
 * already covers.
 */
function enclosingScopes(owningClass: string): string[] {
  const scopes: string[] = [];
  let scope = owningClass;
  while (scope.length > 0) {
    scopes.push(scope);
    const lastDot = scope.lastIndexOf(".");
    if (lastDot === -1) break;
    scope = scope.slice(0, lastDot);
  }
  return scopes;
}

/**
 * Class/type position: nested classes of the owning class and of every enclosing
 * package (the parent scope chain) merged with a fuzzy global match
 * (`searchClassNames`) on the prefix the user is typing. Nearer scopes are pushed
 * first so a name shadowed by an inner scope wins the first-occurrence-wins
 * de-dupe applied at the downstream merge. Reports whether the fuzzy net fired so
 * the caller can mark a prefix-dependent result incomplete.
 *
 * Imported names are absent: `qualifyPath` resolves a typed name but cannot
 * enumerate what an `import` clause brings into scope, so an unqualified import
 * alias won't appear here.
 */
async function classNameCandidates(
  owningClass: string,
  prefix: string,
  client: CompletionClient,
): Promise<ClassNameResult> {
  const out: CompletionCandidate[] = [];

  // The owning class and each enclosing package, nearest first. A bare type
  // reference resolves against this chain, so each level's children are visible
  // local names.
  for (const scope of enclosingScopes(owningClass)) {
    const { classNames } = await tryCall(
      "getClassNames",
      () => client.getClassNames({ typeName: scope }),
      { classNames: [] },
    );
    for (const name of classNames) {
      out.push({ label: name, kind: CompletionCandidateKind.Class });
    }
  }

  // Fuzzy global match on the typed prefix (the last segment under the cursor).
  // searchClassNames returns fully-qualified names. It is a global fuzzy search
  // over every loaded class, so only issue it once the prefix is long enough
  // (`MIN_FUZZY_PREFIX`) to bound the cost a short prefix can't (see the const's
  // note); below the threshold the scoped `getClassNames` above still applies.
  const firedFuzzyNet = prefix.length >= MIN_FUZZY_PREFIX;
  if (firedFuzzyNet) {
    try {
      const { classNames } = await client.searchClassNames({
        searchText: prefix,
      });
      for (const name of classNames) {
        // The label is the fully-qualified name. VSCode filters by the typed
        // word, which stops at the dot, so a bare prefix like `Re` would never
        // match the long label — filter by the last segment. But a global match
        // is not in scope, so insert the FQN: inserting the bare name would
        // leave an unresolvable reference. (`getClassNames` candidates above are
        // in-scope simple names, so their default range/filter is correct.)
        const lastSegment = name.slice(name.lastIndexOf(".") + 1);
        out.push({
          label: name,
          kind: CompletionCandidateKind.Class,
          filterText: lastSegment,
          insertText: name,
        });
      }
    } catch (err) {
      log.debug("language", "completion searchClassNames failed", err);
    }
  }

  return { candidates: out, firedFuzzyNet };
}
