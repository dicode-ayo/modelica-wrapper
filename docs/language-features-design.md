# Language features — design

Editor language intelligence for `.mo` source: **go-to-definition**, **hover**,
**autocomplete**, and **document symbols / outline**. Find-all-references is
explicitly *out of scope here* and tracked as a separate follow-up epic — see
[Future work](#future-work--find-all-references).

## Goal

Make `.mo` files in the workspace behave like a real language in VSCode: jump to
the definition of a class or component, hover for its kind + doc comment,
complete class and member names in context, and navigate via the Outline /
breadcrumbs. All of this without a separate language-server process — we run in
the extension host and reuse the OMC client we already start.

## The load-bearing insight

The three "hard" features are all *semantic* — they need types, inheritance, and
imports, not just syntax. A parser alone gives none of that.

What makes this tractable here is that **the semantic engine already exists** in
this repo: [omc-client](../packages/omc-client/) wraps almost the entire OMC
scripting API, including the two calls that matter most:

- [`qualifyPath`](../packages/omc-client/src/api/contents/qualifyPath.ts) —
  resolves a name *in the context of a class* (honoring `import` and `extends`)
  to its fully-qualified form. This is Modelica name resolution, done by the
  compiler.
- [`getClassInformation`](../packages/omc-client/src/api/browsing/getClassInformation.ts)
  — returns `fileName` + `lineNumberStart/columnNumberStart/lineNumberEnd/columnNumberEnd`
  for any class. This is the definition location, for free.

So the architecture is a **hybrid**: a syntactic front-end (tree-sitter) parses
the editor buffer and tells us *what name/cref the cursor is on and in what
context*; the semantic back-end (OMC) *resolves* that name. tree-sitter is the
easy half; OMC carries the hard half we'd otherwise have to build (a full
Modelica scope engine).

## Non-goals (v1)

- **Find-all-references.** OMC has no global cross-reference index; it requires a
  workspace-wide scan + per-candidate resolution. Own epic. See
  [Future work](#future-work--find-all-references).
- **Rename / refactor.** Depends on references. Later.
- ~~**Syntax highlighting.**~~ **Now in scope.** VSCode highlights via TextMate,
  not tree-sitter. Rather than rely on a separate Modelica extension for color,
  we vendor the MIT-licensed `source.modelica` TextMate grammar from
  [`SimplyDanny/modelica-language-vscode`](https://github.com/SimplyDanny/modelica-language-vscode)
  into `packages/extension/syntaxes/` and contribute it under
  `contributes.grammars` (alongside our own `language-configuration.json` for
  comments/brackets). See History/decisions (2026-05-25).
- **Diagnostics from parsing.** Live model-checking already exists
  ([`commands/live-check.ts`](../packages/extension/src/commands/live-check.ts));
  we do not surface tree-sitter parse errors as diagnostics.
- **Signature help / inlay hints.** Possible later on the same plumbing.

## Background — what we already have, and what's missing

Already present:

- **The whole OMC semantic surface** — `qualifyPath`, `getClassInformation`,
  [`getClassNames`](../packages/omc-client/src/api/browsing/getClassNames.ts),
  [`searchClassNames`](../packages/omc-client/src/api/browsing/searchClassNames.ts),
  [`getElements`](../packages/omc-client/src/api/elements/getElements.ts) /
  [`getComponents`](../packages/omc-client/src/api/contents/getComponents.ts),
  [`getParameterNames`](../packages/omc-client/src/api/parameters/getParameterNames.ts),
  [`getClassComment`](../packages/omc-client/src/api/browsing/getClassComment.ts),
  inheritance walkers
  ([`getInheritedClasses`](../packages/omc-client/src/api/browsing/getInheritedClasses.ts),
  [`extendsFrom`](../packages/omc-client/src/api/browsing/extendsFrom.ts)).
- **A loaded-model lifecycle** — the extension already loads workspace `.mo`
  files on activation (`workspaceContains:**/*.mo` →
  [`workspace-scan.ts`](../packages/extension/src/workspace-scan.ts)), so OMC
  knows the project's classes.
- **A precedent for OMC-fed completion** — the REPL's
  [`repl-complete.ts`](../packages/extension/src/repl/repl-complete.ts), though
  it is purely textual prefix matching, not semantic.

Missing (this epic):

- **No `modelica` language id.** The extension contributes `customEditors`,
  `commands`, `views`, … but **no `languages` entry**. Providers need a
  `DocumentSelector`, so registering the language is foundation work.
- **No syntactic front-end.** Nothing maps a cursor position to a Modelica
  name/cref or classifies its context.
- **No language providers.** Grep confirms zero `registerDefinitionProvider` /
  `registerCompletionItemProvider` / `LanguageClient` today.

## The parser

[`OpenModelica/tree-sitter-modelica`](https://github.com/OpenModelica/tree-sitter-modelica)
— Modelica 3.5, v0.2.2 (Jul 2025), ships a WASM build for
[`web-tree-sitter`](https://www.npmjs.com/package/web-tree-sitter) so it runs
in-process in the extension host (no native rebuild per platform). It ships a
`highlights` query but **no `locals.scm` / `tags.scm`**, which is fine: we do not
use tree-sitter tags for resolution — OMC does that.

## Architecture — the hybrid loop

```
  VSCode request (definition / hover / completion / symbols)
        │
        ▼
  language/parse.ts ──► Tree   (web-tree-sitter, cached per uri+version)
        │
        ▼
  language/cursor.ts ──► { name | cref, context }      (pure, syntactic)
        │
        ▼
  language/resolve.ts ─► OMC: qualifyPath → getClassInformation / getElements
        │                     (+ buffer↔OMC sync)
        ▼
  VSCode Location / Hover / CompletionItem[] / DocumentSymbol[]
```

Document symbols are the exception: they come purely from the tree (no OMC), so
the Outline works even before/without a loaded model.

## Buffer ↔ OMC sync — the real tax

OMC answers about *loaded* models, but the editor buffer drifts on every
keystroke. Policy for v1:

- **Load on open / on save**, not per keystroke: `loadFile` the document's file
  when first touched, re-load on save. Resolution then reflects the last saved
  state. Acceptable for go-to-def/hover; documented as a known limitation for
  completion of just-typed names.
- **Owning class name** for a document is derived from its path within the
  package structure (`package.mo` walk), confirmed via
  [`parseFile`](../packages/omc-client/src/api/lifecycle/parseFile.ts) which
  returns the class names a file defines.
- **Coordinate mapping:** OMC is 1-based (line *and* column); VSCode is 0-based.
  One conversion helper, used everywhere, with tests.
- **Staleness is acceptable** in v1. A live-buffer story (`loadString` of the
  dirty buffer behind a debounce) is a follow-up, noted in open questions.

## File / package layout

New code lives in a flat `packages/extension/src/language/` folder (mirrors the
repo's existing per-area folders like `diagram/`, `results/`, `repl/`):

```
packages/extension/src/language/
  parse.ts            # web-tree-sitter init + per-document Tree cache (incremental)
  cursor.ts           # pure: node-at-position, name/cref under cursor, context kind
  resolve.ts          # OMC resolution: (class, name, context) → target + location
  owning-class.ts     # document uri → owning Modelica class name
  position.ts         # OMC 1-based ↔ VSCode 0-based mapping
  definition-provider.ts
  hover-provider.ts
  symbols-provider.ts
  completion-provider.ts
  index.ts            # registerLanguageFeatures(context, ensureClient)
  *.test.ts           # unit tests (cursor/context/symbols are pure → fixture trees)
```

The grammar WASM (`tree-sitter-modelica.wasm`) is bundled by esbuild and loaded
by path at runtime. `registerLanguageFeatures` is called from
[`extension.ts`](../packages/extension/src/extension.ts) alongside the existing
`context.subscriptions.push(...)` registrations, with the same lazy
`ensureClient` factory.

## Providers, feature by feature

### Document symbols (no OMC)
`DocumentSymbolProvider` walks the tree: classes (nested), components, and the
equation/algorithm sections. Powers Outline, breadcrumbs, and folding. Pure and
fast — the cheapest win and a good first proof the parse layer works.

### Go-to-definition
`DefinitionProvider`: cursor → name/cref (`cursor.ts`) → `resolve.ts`. For a
class/type reference: `qualifyPath` → `getClassInformation` → `Location`. For a
component member cref (`resistor.R`): resolve the head component's type via
`getElements`/`getComponents`, then locate the member. 1-based→0-based mapping.

### Hover
`HoverProvider`: same resolution, rendered as the entity's restriction +
documentation comment (`getClassInformation` / `getClassComment`).

### Autocomplete
`CompletionItemProvider`: the context from `cursor.ts` selects the candidate
source —
- type position / after `extends` → `getClassNames` (children of current +
  imported packages) and `searchClassNames` (fuzzy global),
- member access after `.` → `getElements`/`getComponents` of the head's type,
- modifier name → `getParameterNames`.

Debounced, result-capped, `.` as a trigger character. Reuses the
context-classification logic, not the textual REPL completer.

## The genuinely hard parts / risks

- **Buffer↔OMC staleness** (above) — the main UX limiter; mitigated by
  load-on-save, fixed properly by a live-buffer follow-up.
- **Cref resolution depth** — member access and inherited members need
  inheritance walking; v1 may stop at one hop and grow.
- **Performance** — round-trips per request are fine for def/hover; completion
  needs debounce + caching of class-name lists keyed by the loaded-library set.
- **Modelica scoping** — `encapsulated`, `redeclare`, `inner/outer` edge cases.
  We lean on `qualifyPath` so we inherit OMC's correctness (and its gaps).
- **Coordinate off-by-one** — centralised mapping + tests.

## PR breakdown

1. **Foundation** — contribute the `modelica` language id +
   `language-configuration`; add `web-tree-sitter` + bundle the grammar WASM;
   `parse.ts` (init + cached incremental Tree) and `cursor.ts` (name/cref +
   context, unit-tested).
2. **Resolution layer** — `resolve.ts` + `owning-class.ts` + `position.ts` +
   buffer↔OMC sync (load-on-open/save); tested against a mocked client.
3. **Go-to-definition + hover** — the two providers, wired in `extension.ts`.
4. **Document symbols / outline** — `symbols-provider.ts` (pure, tree-only).
5. **Autocomplete** — `completion-provider.ts` (context → OMC source, debounced).
6. **Polish + perf** — error tolerance on unparseable buffers, caching, perf
   budget for completion, logging via [`logger.ts`](../packages/extension/src/logger.ts),
   final `pnpm -r typecheck` + suites.

## Definition of done

- [ ] `.mo` files have a `modelica` language id; providers bind to it.
- [ ] Go-to-definition jumps to a class/type and a component member at the cursor.
- [ ] Hover shows the entity's kind + doc comment.
- [ ] Autocomplete offers class names (type/`extends` position), members (after
      `.`), and modifier names, in the right context.
- [ ] Outline / breadcrumbs / folding work from the tree alone.
- [ ] OMC 1-based ↔ VSCode 0-based mapping is centralised + tested; existing
      `OmcClient` reused (no new process); `pnpm -r typecheck` + suites pass.

## Future work — find-all-references

Deferred to its own epic because it's the only real project. Sketch: scan all
`.mo` in the workspace + loaded libraries, parse each with tree-sitter to harvest
candidate identifiers, then confirm each via `qualifyPath` to reject
same-name-different-scope. tree-sitter earns its keep here (fast multi-file
parse); cost is per-candidate resolution + scaling to large libraries (MSL).
Rename/refactor builds on top of it.

## Open questions / risks

- Live-buffer resolution (`loadString` of the dirty buffer, debounced) vs
  load-on-save — start with load-on-save, revisit if completion feels stale.
- Should highlighting be in scope (bundle a TextMate grammar) or left to an
  existing Modelica extension? v1: out.
- Member/inherited-cref resolution depth for v1 (one hop vs full walk).
- **Grammar WASM sourcing & freshness.** The prebuilt
  `tree-sitter-modelica.wasm` from the `OpenModelica/tree-sitter-modelica`
  **v0.2.2** GitHub release is **fetched on install** (extension `postinstall`
  → `scripts/fetch-grammar-wasm.mjs`) into `packages/extension/grammar/`, not
  committed — see the 2026-05-25 history entry. The version + SHA-256 + URL pin
  lives in one module (`grammar/grammar-source.mjs`), imported by both the
  fetch script and `esbuild.config.mjs`. esbuild can't inline a `.wasm` for
  path-loading the way it does `.css`, so a small `onEnd` copy step in
  `esbuild.config.mjs` places it — and the `web-tree-sitter` runtime
  `tree-sitter.wasm` — into `out/`; `parse.ts` loads both by absolute path
  from `<extension>/out`. `web-tree-sitter` is `external` in the extension
  bundle (Emscripten glue). Open: there is still no published npm package that
  ships this grammar WASM, so version bumps are manual (bump the pin in
  `grammar-source.mjs`, documented in `grammar/README.md`); a CI step or a
  renovate-style check to track upstream releases is a follow-up.

## History / decisions

- **2026-05-24** — Epic drafted. Hybrid tree-sitter (front-end) + OMC (semantic)
  architecture chosen specifically because OMC is already wrapped here, so the
  expensive scope engine is reused rather than rebuilt. Scope set to go-to-def +
  hover + autocomplete + outline; **find-all-references deferred** to a separate
  epic. Standalone epic with its own `language-features` label.
- **2026-05-25** — PR 1 (foundation) landed: `modelica` language id +
  `language-configuration.json`; `web-tree-sitter` dependency with the vendored
  OpenModelica v0.2.2 grammar WASM (copied into `out/` by esbuild, loaded by
  path); `language/parse.ts` (lazy singleton parser + per-`uri+version` `Tree`
  cache with incremental re-parse); `language/cursor.ts` (pure node-at-position,
  name/cref extraction, and context classification — `type-reference` /
  `extends` / `component-type` / `modifier-name` / `member-access` /
  `component-reference`), unit-tested against real fixture trees; and
  `language/index.ts` `registerLanguageFeatures(context, ensureClient)` wiring
  cache invalidation on document change/close. The grammar WASM is genuinely
  working (tests parse real Modelica), not stubbed.
- **2026-05-25** — Syntax highlighting brought into scope (was a v1 non-goal).
  Vendored the MIT-licensed `source.modelica` TextMate grammar from
  [`SimplyDanny/modelica-language-vscode`](https://github.com/SimplyDanny/modelica-language-vscode)
  (author SimplyDanny / Danny Moesch) at upstream commit
  `54f27789e4bc9b9a24bc06e7a0768c75e15666bc`
  (`syntaxes/modelica.tmLanguage`). Converted the upstream plist form to
  `modelica.tmLanguage.json` verbatim (patterns, captures, `scopeName`, `uuid`
  preserved; only XML entities decoded) and registered it under
  `contributes.grammars` in `packages/extension/package.json`. The Optimica
  grammar was not taken. The MIT license is preserved in
  `packages/extension/syntaxes/LICENSE` and attribution added to the root
  `README.md` (Acknowledgements). License: MIT — reuse permitted with the
  copyright notice retained.
- **2026-05-25** — Grammar WASM switched from **committed-vendored** to
  **fetch-on-install**. The 182 KB `tree-sitter-modelica.wasm` is no longer in
  git (`git rm`, gitignored via `packages/extension/grammar/*.wasm`); instead the
  extension's `postinstall` runs `scripts/fetch-grammar-wasm.mjs`, which
  downloads the pinned v0.2.2 release asset, verifies its SHA-256, and writes it
  into `grammar/`. The pin (version + SHA-256 + URL) now lives in a single
  module, `grammar/grammar-source.mjs`, imported by both the fetch script and
  `esbuild.config.mjs` (whose `copyWasm` SHA gate is retained and whose
  missing-file error now points at `pnpm install`). The fetch is idempotent
  (skips the download when the on-disk hash already matches) and cross-platform
  (Node built-ins only — global `fetch` + `node:crypto`/`node:fs`, no
  bash/curl/gh). **Offline caveat:** first install needs network; air-gapped
  installs must pre-place the pinned `tree-sitter-modelica.wasm` in `grammar/`
  before `pnpm install` (the hash check then accepts it and skips the download).
  Rationale: keep a binary blob out of git history while preserving the
  supply-chain hash invariant. Verified: pnpm runs the **extension package's**
  `postinstall` on a root `pnpm install` (no root-level hook needed).
