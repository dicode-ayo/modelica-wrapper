# Conventions for AI agents

This file is the contract for any agent (Claude Code, Cursor, Copilot, etc.)
editing this repo. Read it before touching code. The README is for humans
browsing the project; this is for *you*.

## Repo shape

- pnpm workspace, six packages under `packages/`. Most language-feature work
  lives in `packages/extension/src/`.
- Pure TypeScript, top to bottom. No Rust/Go backend, no separate server.
- TypeScript is `strict` + `noUncheckedIndexedAccess` (`tsconfig.base.json`).
  Index access types as `T | undefined`; narrow it, don't assert it.

## Commands

```sh
pnpm -r typecheck                            # whole workspace
pnpm --filter modelica-wrapper typecheck     # extension only
pnpm --filter modelica-wrapper test:unit     # vitest unit suite (no live OMC)
pnpm -r test                                 # adds integration when omc is on PATH
```

Don't propose `eslint`/`prettier` runs — neither is configured (only `tsc` +
`vitest`). cSpell flags `Modelica`, `MODELICA`, `dicode`, `openmodelica`,
`modelica` as "Unknown word" — these are project terms; ignore those warnings.

## Code style

### Comments — WHY only, no temporal narrative

The single most important style rule. Default to no comment. Add one only when
the WHY is non-obvious: a constraint, an invariant, a subtle gotcha, behavior
that would surprise a reader.

**Never write:**
- Future references: `PR #97 will consume this`, `before #X lands`, `follow-up`,
  `to be confirmed against live OMC`, `will be wired up later`.
- Past references: `Round-2 added`, `the pre-fix bug`, `/simplify swept`,
  `originally`, `previously`, `we used to`.
- Meta-narrative: `this is deliberately ...`, `the right thing here is ...`,
  hedging (`perhaps`, `arguably`), justification prose, restating what the code
  already does.

The PR description and commit message carry historical context. Code comments
don't. When editing an existing file, trim drift on touch.

### No `!` non-null assertions

`noUncheckedIndexedAccess` is on by repo policy. Use `at(-1)` + an explicit
`if (x === undefined) return ...`, or destructure with a guard, instead of `!`.
Joris reviews catch every `!` that slips in.

```ts
// Good
const last = arr.at(-1);
if (last === undefined) return undefined;

// Bad
const last = arr[arr.length - 1]!;
```

### OMC clients are structural, not `Pick<OmcClient, ...>`

When a module talks to OMC, declare an inline structural interface naming only
the wrappers it calls. `OmcClient` satisfies it; tests mock a plain object.
This mirrors `packages/extension/src/diagram/omc-snapshot.ts` — keep that
pattern, don't refactor to `Pick<OmcClient, "qualifyPath" | ...>`.

```ts
export interface ResolveClient {
  qualifyPath(input: { typeName: string; path: string }): Promise<{ qualifiedPath: string }>;
  getClassInformation(input: { typeName: string }): Promise<{ fileName: string; lineNumberStart: number; columnNumberStart: number }>;
}
```

### Where shared utilities live

- `packages/extension/src/fs-util.ts` — `pathExists` and friends. Don't roll a
  fourth `try { await fsp.access(p); ... }`; use this.
- `packages/extension/src/language/position.ts` — `omcToVscodePosition`,
  `ZeroBasedPosition`, `ZeroBasedRange`. The single 1-based-to-0-based shift.

### OMC coordinate conventions diverge per API

This is the most easily-missed gotcha in the codebase:

- `getClassInformation` reports **inclusive** end columns. Conversion lives in
  `omcRangeToVscodeRange` (`language/position.ts`) — it adds `+1` to the end
  column.
- `getMessagesStringInternal` reports **exclusive** end columns. Conversion
  lives in `rangeFromInfo` (`diagnostics/from-omc.ts`) — no `+1`.

Both call the shared `omcToVscodePosition` for the 1→0 shift, but the
end-column rule stays per-helper. Do *not* factor these into a single helper
without reconfirming both conventions against live OMC.

### Tests pin invariants, not happy paths

Tests use plain mocks and an in-memory `FileProbe`/`OmcClient` — no live OMC.
When you fix a race or close a contract gap, add a test that would have failed
before the fix. Empty `describe` titles like "happy path" are a smell.

## Review cycles

The user runs these as iterative rounds on a PR before merge. Each round is
expected to land follow-up commits.

| Skill | What it does |
| --- | --- |
| `/code-review` (`Skill` tool) | Multi-angle review of the current diff. `--fix` applies the findings; `--comment` posts inline PR comments. |
| `/simplify` | Alias for `/code-review --fix`. Recall-mode review + apply. |
| `/joris-review` (`Agent` tool, `joris-reviewer` subagent) | Joris Kraak-style review — terse, hedged severity in prose, ```suggestion``` blocks, no `nit:` prefix. Strict on `!`, `Pick<>` shape lies, comment drift. |

Typical flow on a feature branch:
1. Implement.
2. `/simplify` — first cleanup pass.
3. `/joris-review` — strictness pass; address what it flags.
4. Trim comment drift introduced by the previous rounds (per the comment rule above).
5. Open / push the PR.

### Conventional Commits

Commit subjects use `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
with an optional scope (`feat(language): ...`). Round-N review-feedback commits
land as `refactor(scope): address PR #NNN round-N review`. The user has
`release-please-config.json` wired up; non-conventional commits break the
release stack.

### When a finding is genuinely out of scope

Skip with a short reason; don't argue. Common skips: cross-package extractions
when only one file is in scope, refactors that need a not-yet-landed consumer,
tooling additions when no config exists (no ESLint config in repo → no
`no-restricted-imports` rule additions).

## Don't

- Don't create new top-level docs (`*.md`) unless asked. `docs/` is human-curated.
- Don't add CLI flags / config knobs for hypothetical callers. Land them with
  the first consumer.
- Don't bypass `git` hooks (`--no-verify`, `--no-gpg-sign`). If a hook fails,
  fix the cause.
- Don't `git push --force` to `main` (or anywhere) without explicit OK.
- Don't `git amend` past commits to fold review-round changes — make a new
  commit. The PR-review history is part of the project record.
