/**
 * The plain-data candidate model the completion core produces, decoupled from
 * `vscode.CompletionItemKind` so the core has no `vscode` dependency. The thin
 * provider maps {@link CompletionCandidateKind} to the editor enum.
 */

/**
 * Upper bound on returned candidates. Completion lists past a few dozen entries
 * stop being useful and the round-trip cost grows, so the merged, de-duped list
 * is truncated to this many items. (VSCode itself filters by the typed prefix,
 * so this is a cost cap, not the user-visible filter.)
 */
export const MAX_COMPLETIONS = 50;

/**
 * Minimum typed-prefix length before the global fuzzy `searchClassNames` fires.
 *
 * `searchClassNames` is a global fuzzy match over *every* loaded class (a full
 * MSL is thousands), and {@link MAX_COMPLETIONS}/`cap` only trims the result
 * AFTER the round trip — so the cap bounds the payload but not OMC's work. A
 * 1-character prefix matches almost everything, making that work near-worst-case
 * on every keystroke. Requiring at least this many characters keeps the cost
 * bounded where the cap can't reach. The cheap, scoped `getClassNames` (the
 * owning class's own children) still runs for short prefixes, so local names are
 * never withheld.
 */
export const MIN_FUZZY_PREFIX = 2;

/**
 * What a candidate *is*, decoupled from `vscode.CompletionItemKind` so the pure
 * core has no `vscode` dependency. `toVscodeCompletionKind` maps these to the
 * editor enum in the thin provider.
 */
export enum CompletionCandidateKind {
  /** A class/type name (model, block, record, …). */
  Class = "class",
  /** A component / member instance of a class. */
  Field = "field",
  /** A parameter / modifiable name. */
  Property = "property",
  /** A Modelica reserved word. */
  Keyword = "keyword",
  /** A code-template snippet whose `insertText` carries placeholder syntax. */
  Snippet = "snippet",
}

/** A single completion candidate, as plain data (no `vscode` types). */
export interface CompletionCandidate {
  /** The text shown in the list (may be a fully-qualified dotted name). */
  readonly label: string;
  /** What the candidate is, driving the icon shown. */
  readonly kind: CompletionCandidateKind;
  /** Optional secondary text (e.g. the member's type). */
  readonly detail?: string;
  /**
   * Optional text VSCode filters the candidate by against the typed prefix.
   * Set when {@link label} is a dotted name (the embedded dots break VSCode's
   * default word-based filtering); left unset to keep the default (filter by
   * the label) for bare simple-name candidates.
   */
  readonly filterText?: string;
  /**
   * Optional text inserted when the candidate is accepted, when it differs from
   * {@link label} (e.g. inserting a dotted class's simple name, not its FQN).
   * When {@link isSnippet} is set, this carries `SnippetString` placeholder
   * syntax.
   */
  readonly insertText?: string;
  /**
   * When set, {@link insertText} is a `SnippetString` template (placeholders
   * like `${1:name}`, `$0`) the provider must wrap so VSCode expands it rather
   * than inserting the syntax verbatim.
   */
  readonly isSnippet?: boolean;
}

/**
 * Outcome of `computeCompletions`: the candidate list plus whether it is
 * incomplete. `isIncomplete` is true only when a contribution depends on the
 * typed prefix and a longer prefix would yield a different set — the fuzzy
 * global `searchClassNames` net. The provider maps this onto
 * `vscode.CompletionList.isIncomplete`: false lets VSCode filter the returned
 * set locally as the user types (no re-query); true makes it re-invoke the
 * provider as the prefix grows.
 */
export interface CompletionResult {
  readonly candidates: CompletionCandidate[];
  readonly isIncomplete: boolean;
}
