# End-to-end test harness

A Playwright + code-server harness that drives the **built** modelica-wrapper
VSCode extension in a real browser. This file lives on `main` so every feature
PR can rebase onto it and add its own `*.spec.ts` for the behavior it
introduces, without re-rolling the harness.

## How to run

First-time setup from the repo root:

```bash
pnpm install                                   # workspace deps
pnpm --filter modelica-wrapper build           # produces out/extension.js
cd packages/extension/e2e && npm ci            # @playwright/test + Chromium
# one-time per machine: code-server on PATH (see Prerequisites)
```

Then, any time:

```bash
pnpm --filter modelica-wrapper test:e2e
# or, equivalently:
cd packages/extension/e2e && npm test
```

`npm ci` inside `e2e/` alone is **not** sufficient — the harness checks
for `out/extension.js` before booting (so the extension must be built first)
and shells out to `code-server` (so it must be on `$PATH`).

Per Playwright worker, the harness:

1. picks a random free port on `127.0.0.1` (never collides with another
   code-server or with the IDE itself),
2. boots a fresh `code-server --auth none … --disable-workspace-trust` against
   a throwaway workspace seeded with `workspace/Demo.mo`,
3. symlinks the extension folder into the temp `--extensions-dir` as
   `drojdestvensky.modelica-wrapper` so code-server picks it up at startup,
4. drives Chromium (from the cached Playwright browser cache) against
   `http://127.0.0.1:<port>/?folder=<workspace>`,
5. tears the code-server child down by **its exact PID** at the end. No broad
   `pkill code-server` — this IDE may itself be a code-server window.

## Parallelism

`playwright.config.ts` sets `fullyParallel: true` and
`workers: process.env.CI ? 2 : "50%"`. Each worker gets its OWN code-server via
the `codeServer` worker-scoped fixture in `test-base.ts` — different port,
isolated `--user-data-dir`, isolated `--extensions-dir`. Specs in different
workers never share workbench state, so adding tests doesn't accumulate
serialized boot cost: N workers run N specs in roughly the time of one. Specs
opt into the fixture by importing `test` from `../test-base.js` instead of
`@playwright/test`.

## What's in scope here vs. in feature PRs

This `main`-based harness only asserts what `main` already contributes:

| Spec | Asserts | Why it can run on `main` |
| --- | --- | --- |
| `extension-loads.spec.ts` | `.monaco-workbench` mounts; the Modelica activity-bar item is registered; clicking it opens the Libraries view with the `viewsWelcome` empty-state ("No Modelica libraries are loaded yet.") | Pure declarative contributions plus on-demand extension activation — no language features required |

**Feature PRs add their own spec(s) here**, rebased onto `main`:

| PR | Suggested spec | What it asserts |
| --- | --- | --- |
| `feat/lang-95-foundation` | `language-baseline.spec.ts` | Open `Demo.mo` → status-bar shows `Modelica` + `.mtk*`-tokenised `model` keyword (grammar + language id) |
| `feat/lang-97-defhover` | `definition-hover.spec.ts` (gated `E2E_OMC=1`) | `F12` jumps; hover on `R` shows its doc string |
| `feat/lang-98-outline` | `outline.spec.ts` | Outline lists `Demo`, `R`, `i`, `v` (proves activation + tree-sitter WASM parse + OMC-free symbol provider) |
| `feat/lang-99-autocomplete` | `completion.spec.ts` (gated `E2E_OMC=1`) | Typing `.` inside a cref triggers the completion list |

Shared helpers (`helpers.ts`) provide `waitForWorkbench`, `workbenchUrl`,
`openFileViaQuickOpen`, and `runCommandPaletteCommand` — use them.

## Prerequisites

- `code-server` on `$PATH` (verified against `4.108.0` / VSCode `1.108.0`,
  compatible with the extension's `engines.vscode: ^1.95.0`).
- Playwright Chromium cached at `~/.cache/ms-playwright/chromium-*` (no browser
  download is performed by this harness).
- The extension must be built first — `out/extension.js` must exist. Run
  `pnpm --filter modelica-wrapper build` if not. (Feature PRs that introduce
  `tree-sitter*.wasm` will also need those next to `extension.js`; the harness
  surfaces a clear "out/extension.js missing" error otherwise.)

## Layout

```text
packages/extension/e2e/
├── code-server-harness.ts   # spawn/teardown (kills only its own PID)
├── helpers.ts               # shared selectors / workbench helpers
├── package.json             # @playwright/test devDep + `npm test` script
├── playwright.config.ts     # workers + Chromium project + generous timeouts
├── README.md                # this file
├── specs/
│   └── extension-loads.spec.ts   # baseline (this PR)
├── test-base.ts             # worker-scoped `codeServer` fixture
├── tsconfig.json
└── workspace/
    └── Demo.mo              # fixture for feature-PR specs to use
```

The harness deliberately does **not** touch anything under
`packages/extension/src/**` — it's pure test infrastructure that runs against
the already-built `out/` bundle.

## Safety rule

This IDE may itself be a code-server. The teardown kills **only the exact PID**
of the code-server it spawned. **Never** add a `pkill code-server`, `killall`,
or `pkill -f code-server` to this harness.

## Troubleshooting

- **`e2e prerequisite missing: out/extension.js`** — run
  `pnpm --filter modelica-wrapper build` first.
- **Spec hangs at "waiting for `.monaco-workbench`"** — first boot of
  code-server compiles workbench assets; the test gives it 60 s. Check the
  per-run log path printed at the top of the run (`code-server.log`) for a
  fatal error.
- **A code-server process is lingering** — the teardown kills only the spawned
  PID. If an earlier run was `kill -9`-ed before teardown completed, find that
  PID by hand and kill it. Do **not** broad-`pkill`.
