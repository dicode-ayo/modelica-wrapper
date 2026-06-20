# diagram-ui end-to-end tests

A Playwright harness that drives the `<om-*>` web components through their
**Storybook** stories in a real Chromium. It exists for the interactions the
happy-dom unit suite can't run:

- a Lit `@event` listener on a custom element does **not** fire under happy-dom
  (manual `addEventListener` does), so the menu/select wiring is invisible there;
- the Babylon canvas pointer path and pan/zoom need a real renderer.

So the right-click → context-menu → run-command flow, the right-click selection
semantics, and the menu tracking its diagram point through zoom are all verified
here rather than in `test/`. Runs in CI as `E2E (Playwright + diagram-ui)`.

## How to run

First-time setup from the repo root:

```bash
pnpm install                                              # workspace deps
pnpm --filter @dicode/diagram-ui exec playwright install chromium
```

Then, any time (from the repo root):

```bash
pnpm --filter @dicode/diagram-ui test:e2e
```

You do **not** need to start Storybook yourself — Playwright's `webServer`
(`playwright.config.ts`) boots it on `:6007` and tears it down. If a Storybook
is already running there it's reused (locally); under `CI` it always starts its
own.

### Interactive modes

When you need to see or step through what a spec does:

| Mode | Command (from repo root) | Good for |
| --- | --- | --- |
| Headless | `pnpm --filter @dicode/diagram-ui test:e2e` | the default; fast |
| Headed | `pnpm --filter @dicode/diagram-ui test:e2e:headed` | watch the real Chromium drive the story |
| UI mode | `pnpm --filter @dicode/diagram-ui test:e2e:ui` | timeline + per-step DOM snapshots + time-travel — reach for this first |
| Inspector | `pnpm --filter @dicode/diagram-ui test:e2e:debug` | line-by-line stepping; `await page.pause()` drops you in |
| Trace replay | `pnpm --filter @dicode/diagram-ui exec playwright show-trace test-results/*/trace.zip` | post-mortem of a failed run (traces retained on the CI retry) |

Headed/UI/Debug need a display (`DISPLAY`/`WAYLAND_DISPLAY`); they won't render
over a plain SSH session without X forwarding. To follow a headed run step by
step, slow it down:

```bash
SLOW_MO=400 pnpm --filter @dicode/diagram-ui test:e2e:headed
```

Focus one scenario with a title filter:

```bash
pnpm --filter @dicode/diagram-ui test:e2e:ui -g "tracks its diagram point through zoom"
```

The specs drive the same `diagram-ui/GraphicalLayout` story you can poke by
hand: `pnpm --filter @dicode/diagram-ui start` → http://localhost:6007.

## Prerequisites

- `@playwright/test` is a pinned devDep of `@dicode/diagram-ui` (`1.60.0`, kept
  in lockstep with the extension e2e suite and the cached browser). Installed by
  the workspace `pnpm install`.
- Playwright Chromium cached at `~/.cache/ms-playwright/chromium-*` — installed
  once via `playwright install chromium` above; CI uses `--with-deps`.

## Adding specs

Feature PRs that add a component interaction add a `<name>.spec.ts` here and a
story for it to drive. Reach the host/scene the in-page helpers need by querying
`om-graphical-layout` / its `om-scene`; keep the element shapes defined once at
the top of the file rather than re-cast in every `page.evaluate`.

## Layout

```text
packages/diagram-ui/
├── playwright.config.ts        # webServer boots Storybook; chromium project
└── e2e/
    ├── README.md               # this file
    └── context-menu.spec.ts    # right-click menu: select / run / zoom-track
```

The harness is pure test infrastructure — it drives the running Storybook, not
`src/**`.
