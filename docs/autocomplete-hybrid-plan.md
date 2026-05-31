# Autocomplete — hybrid implementation plan

[← back to README](../README.md) · related:
[omedit-completion-reference.md](omedit-completion-reference.md) ·
[language-features-design.md](language-features-design.md) ·
[omc-client.md](omc-client.md)

A phased plan to evolve our completion provider into a hybrid that takes the
**better half of each** design: OMEdit's *inheritance-aware, pre-elaborated
model* and *static keyword/type/snippet channels*, plus our *tree-sitter context
routing* (more precise than OMEdit's textual heuristics) and the *loaded-library
cache* already built in PR #112. Background + the reference it's measured
against live in [omedit-completion-reference.md](omedit-completion-reference.md).

## The insight

The two completers win at different layers, so combining them is strictly
better, not a compromise:

| Layer | OMEdit | Ours today | Hybrid takes |
| --- | --- | --- | --- |
| Routing (what kind of completion) | textual (last-dot split, paren stack, uppercase heuristic) | **tree-sitter AST context** | **ours** + OMEdit's textual *fallback* for broken buffers |
| Resolution model (candidates) | **pre-elaborated, inheritance-aware tree** | live `getComponents` = *own members only* | **OMEdit's model**, realized via `getElements`/`getModelInstance` |
| Static candidates | keywords + built-in types + snippets | none | **add them**, routed by tree-sitter context |
| Freshness / cost | persistent tree (can stale) | live, per-keystroke | **the #112 cache** (live + invalidate-on-save) |
| Gradual narrowing | `QCompleter` re-filters its model | returns one flat list | **VSCode `isIncomplete`** + dot-walk + cache |

The single most load-bearing fix is **inheritance**: bare `getComponents(type)`
returns only a class's *own* declared members, so for MSL types (mostly
inherited) the `r.` member list is largely empty/wrong. That is the prime
suspect behind "not doing what it's supposed to at all."

## Target shape

- `computeCompletions` stays the pure core, routed by the
  [`cursor.ts`](../packages/extension/src/language/cursor.ts) context, with a
  textual fallback when the parse is unusable.
- Candidate sources, by context:
  - **member-access (`a.b.`)** → enumerate an **inheritance-inclusive** element
    list of the resolved head type (`getElements` or `getModelInstance.elements`),
    walked dot-by-dot, cached.
  - **type / `extends`** → `getClassNames` (children) + enclosing-scope classes +
    built-in types + fuzzy `searchClassNames`.
  - **modifier-name** → `getParameterNames` (verify it returns inherited).
  - **statement / element position** → keyword + snippet channels.
  - **value / equation / unknown** → nothing.
- Each candidate carries the right `vscode.CompletionItemKind`
  (`Class`/`Field`/`Property`/`Keyword`/`Snippet`/`Unit`).
- The provider returns a `CompletionList` with `isIncomplete` set per context.

## Phases

Each phase is an independent `feat`/`fix(language)` PR with tests; ordered by
payoff-per-effort. All build on the merged completion provider (#111) and the
lookup cache (#112).

### Phase 0 — Empirical: pick the inheritance-inclusive call · *spike*
- Against live OMC, compare `getComponents`, [`getElements`](../packages/omc-client/src/api/elements/getElements.ts),
  and `getModelInstance(T).elements` for an inherited-heavy type (e.g.
  `Modelica.Electrical.Analog.Basic.Resistor`): which include inherited members,
  and at what cost.
- Decide the member-source call. (OMEdit uses `getElements(className,
  useQuotes=true)`; `getModelInstance` is the deeper unification — shared with
  the diagram model.)
- **Done when** the choice is recorded here and in the PR.

### Phase 1 — Inheritance fix in member resolution · *highest payoff*
- Swap [`memberCandidates`](../packages/extension/src/language/completion-provider.ts)
  / the member walk in [`resolve.ts`](../packages/extension/src/language/resolve.ts)
  to the Phase-0 call so `r.` lists inherited members.
- Route the new call through the [#112 cache](../packages/extension/src/language/omc-cache.ts).
- **Test:** a type with an `extends` base — assert inherited members appear
  (would fail today). Mock client returns base + derived; expect the union.

### Phase 2 — Static channels: keywords, built-in types, snippets · *cheap, visible*
- Add static sources (mirror OMEdit's `getKeywords()` / `getTypes()` /
  `getCodeSnippets()`): Modelica keywords (`extends`, `parameter`, `model`, …),
  built-in types (`Real`/`Integer`/`Boolean`/`String`), and class/loop snippets.
- Route by tree-sitter context (more precise than OMEdit's uppercase heuristic):
  keywords + snippets in statement/element position, built-in types merged into
  type/`extends` position, none after a dot or in value position.
- Tag with `CompletionItemKind.Keyword`/`.Class`/`.Snippet`; snippets use a
  `SnippetString` insert.
- **Test:** each context surfaces the right static set and *suppresses* the wrong
  ones (e.g. no keywords after `.`).

### Phase 3 — Textual routing fallback for broken buffers · *robustness*
- When `targetAt` yields no usable context (mid-edit, unparseable), fall back to
  the textual "word-before-caret, split on last dot" heuristic (extend the
  existing `headBeforeDot`) so the popup still appears on `r.|`.
- **Test:** a syntactically broken buffer still routes `r.` to member completion.

### Phase 4 — Gradual resolution via `isIncomplete` · *tiny, big UX*
- Return a `vscode.CompletionList` with `isIncomplete: false` for **stable**
  contexts (members, keywords, local class names) so VSCode filters locally as
  the user types (no re-query); `isIncomplete: true` for the **fuzzy global**
  `searchClassNames` so it re-queries as the prefix grows.
- **Test:** assert the flag per context (pure-core can return the flag in its
  result shape; the wrapper maps it onto `CompletionList`).

### Phase 5 — Enclosing-scope (visible-name) classes in type position · *correctness*
- Beyond the owning class's children, include classes visible from enclosing
  packages (walk parents, à la OMEdit's `getCandidateContexts`).
- Imports remain the honest hard part — `qualifyPath` resolves a *typed* name but
  doesn't *enumerate* imported names; note the limitation rather than fake it.
- **Test:** a sibling class in an enclosing package appears in type position.

### Phase 6 — Unit-value completion · *nice-to-have, later*
- In modifier position where the attribute is `unit`/`displayUnit`, offer a
  static SI-unit list (or `getDerivedUnits`), tagged `CompletionItemKind.Unit`.
- **Test:** `R(unit="|")` surfaces unit strings; ordinary modifiers do not.

## Open question to resolve in Phase 0

Does our omc-client parse of `getElements` / `getModelInstance.elements` include
**inherited** components? OMEdit relies on `getElements` for exactly this, so it
almost certainly does — but confirm against live OMC before committing Phase 1 to
a specific call.

## Out of scope

- A persistent in-memory library tree (OMEdit's `LibraryTreeItem`). The #112
  cache is our equivalent — fetch-on-demand + invalidate-on-save — and avoids the
  staleness/maintenance cost of a long-lived tree.
- `DynamicSelect` / annotation-graphics completion (a diagram concern, see
  [diagram-omc-reference.md](diagram-omc-reference.md)).
- Find-all-references and other non-completion language features.
