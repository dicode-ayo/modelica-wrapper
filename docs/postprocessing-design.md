# Postprocessing view — design

[← back to README](../README.md) · related: [architecture.md](architecture.md) ·
[protocol.md](protocol.md) · [omc-client.md](omc-client.md) ·
[multibody-preview-design.md](multibody-preview-design.md)

Status: **design, pre-implementation.** A second webview, independent of the
diagram. The data read path (`.mat` → trajectories) already exists as typed
wrappers; this doc designs the document model, the host orchestration, the Lit UI,
and the charting layer that sit on top of them.

## Goal

A separate VSCode webview for **postprocessing simulation results**: collect a set
of result files (`.mat`), browse their variables, and overlay their trajectories on
plot cards. Modelled on the [Dyad runtime POC](https://github.com/JuliaComputing/dyad-runtime-poc)'s
run editor — but with one deliberate difference (next section): the view is **not
bound to a single model**. A view holds an arbitrary set of `.mat` files, each
possibly produced by a *different* model simulation, and a user **or our own code**
can add any `.mat` to it.

Results enter a view three ways: a manual file pick, an automatic add when the
diagram's **Simulate** action finishes, and a quick-pick over the workspace
`.modelica/` cache.

## Non-goals (v1)

- **No re-running from this view.** There is no "Run" button bound to the document
  (Dyad has one because a `.dyadrun` *is* one analysis; ours is a heterogeneous
  collection). Re-running stays on the diagram's Simulate action, which then *feeds*
  this view.
- **Markdown / computed-value cards.** v1 is plots only. The `Card` union is left
  open so note/value cards slot in later without a migration (see [the model](#the-document-model--resultviewdoc)).
- **No new OMC process / transport.** All reads go through the existing `OmcClient`
  singleton over the existing ZeroMQ link.
- **No bespoke trajectory math** (FFT, derivatives, cross-plots beyond x=time). A
  per-card `xVariable` seam is reserved but only `time` ships in v1.

## Background — the reference, and what we already have

The Dyad POC is a `vscode.CustomTextEditorProvider` over a JSON `.dyadrun` file. Its
shape, distilled:

- The JSON doc holds `analysis`, `parameters`, a shared `signals` list, a
  `solutions[]` array (each a *run* of the one analysis), and `plots[]` (plot or
  markdown **cards**). Each plot card holds `traces`, where a trace is a
  `{ solution, signal }` pair, so several runs overlay on one chart.
- The webview is a **dumb renderer**. The host reads signal data from a Julia server,
  caches it in-memory (`solId → signal → {t, values}`), and posts `plotTraces` to the
  webview, which charts them with **Plotly**. Every doc mutation (add plot, add trace,
  delete solution) is a `WorkspaceEdit` on the JSON, so **undo/redo and git come for
  free**.

We already own the equivalent read path — no Julia, no new transport:

| Need | Existing typed wrapper | Location |
| --- | --- | --- |
| List variables in a `.mat` | `readSimulationResultVars(fileName)` → `{ vars }` | [results/readSimulationResultVars.ts](../packages/omc-client/src/api/results/readSimulationResultVars.ts) |
| Read trajectories | `readSimulationResult(filename, variables, size)` → `Real[:,:]` | [results/readSimulationResult.ts](../packages/omc-client/src/api/results/readSimulationResult.ts) |
| Scalar at a time point | `val(var, timePoint, fileName)` | [results/val.ts](../packages/omc-client/src/api/results/val.ts) |
| Downsample / subset to a smaller `.mat` | `filterSimulationResults(...)` | [results/filterSimulationResults.ts](../packages/omc-client/src/api/results/filterSimulationResults.ts) |
| Release a file handle (Windows) | `closeSimulationResultFile(fileName)` | [results/closeSimulationResultFile.ts](../packages/omc-client/src/api/results/closeSimulationResultFile.ts) |

All of these serialize through the same promise-chain mutex as every other OMC call,
so the postprocessing reads share the diagram's single `omc` subprocess.

## How this differs from Dyad — the load-bearing difference

| | Dyad `.dyadrun` | This `.omresults` |
| --- | --- | --- |
| Bound to | one **analysis** | nothing — a free collection |
| Result entry | a **solution** = a run of *the* analysis | a **result** = any `.mat` file |
| Variable list | one **shared** `signals` list (same model ⇒ same signals) | **per-result** — discovered lazily via `readSimulationResultVars` |
| How results arrive | the doc's own **Run** button | manual pick · auto-add on Simulate · `.modelica` cache |
| Trace key | `{ solution, signal }` | `{ result, variable }` |

The consequence that ripples through the whole design: **there is no global signal
list**. Each result carries its own variable set, so the add-trace UI scopes the
variable picker to the *selected result*, and the variable list is fetched on demand
(and cached per file), never stored in the document. This is exactly the freedom the
goal asks for — a view can overlay `motor.w` from `DCMotor_res.mat` against
`tank.level` from a completely different model's `.mat`.

## The document model — `ResultViewDoc`

A JSON file `*.omresults`, edited through a `CustomTextEditorProvider`. The schema is
pure and host-agnostic, living beside the other shared contracts in
`packages/omc-client/src/_shared/resultView.ts` (Zod, `.strict()`, mirroring
`diagramLayout.ts` conventions):

```ts
interface ResultRef {
  id: string;                  // stable id minted on add (random); trace keys reference it
  label: string;               // user-facing (default: model name, else file stem)
  path: string;                // .mat path — relative to the doc when under its folder, else absolute
  model?: string;              // className that produced it, when known
  createdAt?: string;          // ISO timestamp
  source: "simulate" | "import" | "cache";   // how it entered the view (badge in UI)
  // best-effort provenance, captured at add time:
  parameters?: Record<string, string>;        // run overrides, when added from Simulate
  commit?: string | null;
  dirty?: boolean | null;
}

interface Trace { result: string; variable: string; }  // result === ResultRef.id

interface PlotCard {
  kind: "plot";
  title?: string;
  traces?: Trace[];
  xVariable?: string;          // forward-looking; defaults to "time"
}
type Card = PlotCard;          // v1: one variant; the union stays open for note/value cards

interface ResultViewDoc {
  version: 1;                  // for forward migration
  results: ResultRef[];
  cards: Card[];
}
```

Decisions baked into the shape:

- **No `signals` field** — the single biggest divergence from Dyad. Per-result
  variable lists are runtime data, fetched and cached, never persisted.
- **`Card` is a discriminated union with `kind: "plot"`** even though there's one
  variant, so markdown/value cards land later without a doc migration — the same
  foresight as `ParameterField`'s names mirroring the `Dialog` record
  ([parameter-model-design.md](parameter-model-design.md)).
- **`path` relative-when-local, absolute-otherwise.** A `.mat` under the doc's
  sibling folder is stored relative (portable, git-friendly); one picked from
  elsewhere on disk is stored absolute. Resolution mirrors Dyad's `resolveRunPath`.
- **`version` from day one** so the parser can migrate older files in place.

## Data path

All of it pure where it can be; the only I/O is the two OMC reads.

```mermaid
flowchart TB
    DOC[".omresults JSON"] -->|parseResultViewDoc (pure)| RVD[ResultViewDoc]
    RVD -->|tracesNeedingData (pure)| PLAN["missing (result → vars)"]
    PLAN -->|per result path| RV["readSimulationResultVars(path)"]
    PLAN -->|per result path| RR["readSimulationResult(path, [time, ...vars])"]
    RV --> CACHE["host cache (path+mtime → vars, series)"]
    RR --> CACHE
    CACHE -->|"{t, values, name}"| TP[TracePayload]
    TP -->|postMessage| CARD["&lt;om-result-plot-card&gt; → ECharts"]
```

`time` is read alongside each requested variable so every trace carries its own
x-axis (necessary — see [risks](#open-questions--risks): overlaid results have
different time grids).

## Pure helpers — split by consumer

Unlike `produceDiagramLayout` / `produceParameterModel`, the document is **not** an
OMC product — nothing in it is derived from an OMC call. So only the *types + Zod
schemas* live in the shared `omc-client` base (the one package both sides import,
like `DiagramLayout`); the behaviour lives **with whoever consumes it**. All of it is
pure and unit-tested with zero OMC dependency.

```ts
// @modelica-wrapper/omc-client — _shared/resultView.ts  (the wire contract)
//   types: ResultRef, Trace, PlotCard, Card, ResultViewDoc, ResultSource
//   schemas: ResultRefSchema, TraceSchema, PlotCardSchema, CardSchema,
//            ResultViewDocSchema
//   emptyResultViewDoc(): ResultViewDoc

// extension — src/results/result-doc.ts  (host-only: file I/O + read-planning)
parseResultViewDoc(text: string): ResultViewDoc            // tolerant parse + defaults
serializeResultViewDoc(doc: ResultViewDoc): string         // stable, pretty, canonical JSON
traceCacheKey(resultId: string, variable: string): string
tracesNeedingData(                                         // which (result, var) pairs to read
  doc: ResultViewDoc,
  cached: ReadonlySet<string>,
): Map<string /*resultId*/, Set<string /*variable*/>>

// result-ui — src/var-tree.ts  (webview-only: the picker)
buildVariableTree(vars: readonly string[]): VarNode[]      // dotted names → hierarchy
```

`buildVariableTree` is the pure core of Dyad's cascading-select logic (its
`_optionsAt` / `_currentPath`), lifted out so the picker UI and its tests share one
implementation. `parse`/`serialize` are host-only — the webview never parses the file
(it receives an already-parsed `doc` over `postMessage`), exactly as Dyad's editor
provider owns `parseDoc` / `docToText`. The two reads (`readSimulationResultVars`,
`readSimulationResult`) stay at the host edge — they need a live `CallContext`.

## Host orchestration — `extension`

A new `ResultViewEditorProvider implements vscode.CustomTextEditorProvider`, sibling
to the diagram's `DiagramPanel`:

- Registers view type `modelica.resultView` for `*.omresults`
  (`package.json` `customEditors` contribution).
- Renders CSP-locked HTML (mirroring `panel.ts`) that loads a **new**
  `out/postprocessing.js` + `out/postprocessing.css` bundle, root element
  `<om-result-view-root>`.
- Reuses the extension's existing **lazy `OmcClient` singleton** — the same client
  the diagram drives — so `.mat` reads serialize through the one promise-chain mutex
  and the one `omc` process. No second backend.

Lifecycle, mirroring Dyad's provider but reading from OMC, not Julia:

```mermaid
sequenceDiagram
    participant W as Webview
    participant H as ResultViewEditorProvider
    participant C as OmcClient
    participant O as omc

    W->>H: ready
    H->>H: parseResultViewDoc(document.getText())
    H->>H: tracesNeedingData(doc, cacheKeys)
    loop per result path with missing vars
        H->>C: readSimulationResult(path, [time, ...vars])
        C->>O: readSimulationResult(...)
        O-->>C: Real[:,:]
        H->>H: cache by (path + mtime)
    end
    H->>W: doc { doc, traceData }
    Note over W: ECharts renders; no blank flash (cache filled before post)
```

Mutations are `WorkspaceEdit`s on the JSON document (Dyad's `applyDocEdit`), so undo,
redo, dirty-indicator, and git diffs all work with no extra code:
`addPlot` / `deletePlot` / `addTrace` / `removeTrace` / `addResult` / `removeResult` /
`renameResult`.

**Caching & invalidation.** An in-memory `Map<pathKey, { mtimeMs, vars, series }>`,
where `pathKey = resolvedPath`. A read is reused while `mtimeMs` is unchanged; a
rewritten `.mat` (re-run to the same path) invalidates it. On Windows, call
`closeSimulationResultFile` before re-reading a path whose file changed.

**Lazy variable lists.** The add-trace picker requests a result's variables on demand
(`requestVariables { requestId, resultId }` → `variables { requestId, vars }`),
correlated by `requestId` exactly like the diagram's library browser
([protocol.md](protocol.md#library-requestresponse-correlation)), cached per
`path+mtime`.

## How results are added — the three paths

1. **Manual file pick** (`source: "import"`). An *Add result…* control calls
   `showOpenDialog({ filters: { "Result files": ["mat"] }, canSelectMany: true })`;
   each pick appends a `ResultRef` (label = file stem) via `WorkspaceEdit`.
2. **Auto-add on Simulate** (`source: "simulate"`) — the "our code adds it" path.
   `runSimulate` already extracts `resultFile`
   ([open-diagram.ts:739](../packages/extension/src/diagram/open-diagram.ts#L739)).
   On success it calls a single programmatic entry point:

   ```ts
   vscode.commands.executeCommand("modelica.addResultToView", matPath, {
     model: className, parameters: overrides, source: "simulate",
   });
   ```

   The command targets the **active result view** (tracked like Dyad's
   `getActiveAnalysis`). If none is open, it shows a notification with an
   *Add to new result view* action that creates `<model>.omresults` and adds it.
   Routing through a command (not a direct call) means any other producer — a batch
   runner, a script, a future analysis driver — can feed the view too.
3. **Browse `.modelica/` cache** (`source: "cache"`). A `showQuickPick` lists `*.mat`
   under the workspace cache dir (`WORKSPACE_CACHE_DIRNAME` from
   [extension.ts](../packages/extension/src/extension.ts)), newest first, multi-select.

## Webview — Lit components (`om-` prefix) — `result-ui`

The webview lives in its own package, **`@modelica-wrapper/result-ui`** — Lit +
ECharts custom elements with the `om-` prefix, kept **independent of `diagram-ui`**
(no Babylon) so it can be bundled and distributed on its own. The bridge that touches
`vscode.postMessage` lives in the *extension* package, like `<om-webview-root>`; the
components themselves stay host-agnostic.

| element | package | role |
| --- | --- | --- |
| `<om-result-view-root>` | extension (`src/webview/postprocessing-entry.ts`) | the **only** caller of `vscode.postMessage`; provides Lit contexts; DOM-event ⇄ postMessage bridge |
| `<om-result-view-app>` | result-ui | layout: a **results rail** on the left, a scrollable **cards column** on the right (Dyad's params pane is replaced by the results list) |
| `<om-results-drawer>` | result-ui | one chip per result (label, model, timestamp, `source` badge); the add-result menu (three paths); rename / remove |
| `<om-cards-list>` | result-ui | the card column with "+ Plot" inserters |
| `<om-result-plot-card>` | result-ui | one plot; ECharts overlay of its traces; per-trace remove; embeds the add-trace row |
| `<om-add-trace-row>` | result-ui | result `<select>` + **cascading variable picker** built from `buildVariableTree` over the *selected result's* variables |

State follows the **Lit context** pattern (a small reactive store provided by the
root, consumed by descendants) rather than adding Dyad's `rxjs` dependency — flagged
as a decision in [risks](#open-questions--risks).

Design tokens / theming: shared via **`@modelica-wrapper/ui-common`** — the `--om-*`
token sheet (`omTokens`) and the Web Awesome → VSCode bridge (`webawesome-setup` +
`wa-bridge.css`) were extracted there from `diagram-ui` so `result-ui` reuses them
**without** depending on `diagram-ui` (no Babylon). `result-ui` will import `omTokens`
from `@modelica-wrapper/ui-common` when its components land (#84).

## Charting layer — ECharts

- `echarts` added to `result-ui` deps and bundled into `postprocessing.js`
  (one IIFE, consistent with `webview.js`; CSP stays `script-src` nonce/cspSource —
  no external CDN).
- A `buildEchartTheme()` reads `--vscode-*` / `--om-*` CSS variables at runtime and
  refreshes on `workbench.colorTheme` change — **no hardcoded colors**, honoring the
  token rule, mirroring Dyad's `getPlotlyLayout()`.
- One `echarts.setOption` per card: x-axis from `time` (or `xVariable`), each trace a
  `line` series, with `legend` toggling, `dataZoom` (box + scroll) for pan/zoom, and a
  crosshair `tooltip` — all built-ins. A `ResizeObserver` per container drives
  `chart.resize()`.

```ts
interface TracePayload { t: number[]; values: number[]; name: string; }
// host: readSimulationResult(path, ["time", variable]) → rows [t, y]
//       name = `${resultLabel} / ${variable}`
```

## Message protocol

Two tagged unions in a new
`packages/extension/src/webview/postprocessing-protocol.ts`, sibling to
[protocol.ts](../packages/extension/src/webview/protocol.ts), discriminated on `type`,
all JSON-serialisable. As in the diagram, there are two hops: DOM `CustomEvent`s
inside the webview, then `postMessage` across the boundary.

### Host → webview

| `type` | Payload | Meaning |
| --- | --- | --- |
| `doc` | `{ doc: ResultViewDoc, traceData: Record<number, TracePayload[]> }` | Seed / refresh; `traceData` keyed by card index, prefilled from cache so charts never flash blank. |
| `variables` | `{ requestId, resultId, vars?, error? }` | Lazy variable list for one result. |
| `traceData` | `{ cardIndex, trace: TracePayload }` | Incremental single-trace append. |
| `loading` | `{ area: "results" \| "plots", busy }` | Spinner gating. |
| `status` | `{ message, error? }` | Surface a read/parse error. |

### Webview → host

| `type` | Payload | Meaning |
| --- | --- | --- |
| `ready` | `{}` | Webview mounted; host sends `doc`. |
| `addPlot` / `deletePlot` | `{ afterIndex }` / `{ cardIndex }` | Card CRUD. |
| `addTrace` / `removeTrace` | `{ cardIndex, resultId, variable }` / `{ cardIndex, traceIndex }` | Trace CRUD. |
| `requestVariables` | `{ requestId, resultId }` | Fetch a result's variable list. |
| `addResult` | `{ via: "pick" \| "cache" }` | Host opens the dialog / quick-pick. |
| `removeResult` / `renameResult` | `{ resultId }` / `{ resultId, label }` | Result CRUD. |
| `error` | `{ message }` | Diagnostic from the webview. |

## File / package layout

```
packages/omc-client/src/
  _shared/
    resultView.ts              # the wire contract: types + Zod schemas + emptyResultViewDoc
    resultView.test.ts         # schema tests
                               # (DONE in #82)

packages/result-ui/                # NEW standalone package — no Babylon, no diagram-ui dep
  package.json · tsconfig.json · vitest.config.ts   # (DONE in #82)
  src/
    index.ts                   # barrel (DONE in #82)
    var-tree.ts                # buildVariableTree + VarNode (DONE in #82)
    var-tree.test.ts           # DONE in #82
    result-view-app.component.ts # NEW
    results-drawer.component.ts  # NEW
    cards-list.component.ts      # NEW
    result-plot-card.component.ts# NEW — ECharts
    add-trace-row.component.ts   # NEW — cascading picker over buildVariableTree
    echart-theme.ts              # NEW — CSS-var → ECharts theme (tokens via ui-common)
  stories/
    Postprocessing.stories.ts    # NEW — hand-built ResultViewDoc + mock TracePayloads

packages/ui-common/src/          # shared tokens + WA bridge, extracted from diagram-ui
  om-tokens.ts · wa-bridge.css · webawesome-setup.ts   # (DONE in #82)

packages/extension/src/
  webview/
    postprocessing-entry.ts    # NEW — <om-result-view-root> bridge
    postprocessing-protocol.ts # NEW — the two tagged unions
  results/
    result-doc.ts              # parse/serialize + tracesNeedingData (host I/O, DONE in #82)
    result-doc.test.ts         # DONE in #82
    result-view-provider.ts    # NEW — CustomTextEditorProvider
    add-result.ts              # NEW — three add paths + modelica.addResultToView command
    result-cache.ts            # NEW — path+mtime → {vars, series}
  esbuild.config.mjs           # MODIFIED — third bundle target
  package.json                 # MODIFIED — customEditors + commands contributions
```

`esbuild.config.mjs` gains a third target (entry `webview/postprocessing-entry.ts` →
`out/postprocessing.js` + `.css`, `tsconfig.webview.json`, same `.css` loader),
reference-counted into the existing watch markers.

## Open questions / risks

1. **Time column.** OMC `.mat` results carry `time`; confirm and handle the rare
   result with a renamed/absent independent variable (fall back to row index, or flag
   the result unreadable rather than mis-plotting).
2. **Heterogeneous x-axes.** Overlaying results from different models means different
   time ranges *and* sample grids. ECharts handles per-series `[x, y]` pairs, so each
   `TracePayload` must carry its own `t` (it does) — there is **no** shared doc-level
   time vector.
3. **Large results.** `readSimulationResult` returns the full matrix parsed to numbers;
   a 10⁵-row run × many vars is heavy over ZMQ + the recursive-descent parser. v1
   reads only referenced variables; downsample-on-read via `filterSimulationResults`
   is a follow-up if needed.
4. **File handles & re-runs (Windows).** Re-running to the same path rewrites the
   `.mat`; key the cache on `path + mtime` and `closeSimulationResultFile` before a
   re-read.
5. **Dangling results.** A `ResultRef.path` can be moved/deleted. Show the chip as
   *missing* and skip its traces instead of crashing (Dyad's "continue" guards).
6. **Single-threaded OMC.** A big read blocks the diagram's call queue. Acceptable
   (shared client), but reads stay lazy + cached and show progress.
7. **Active-view targeting.** How `modelica.addResultToView` picks "the" view when
   several are open — most-recently-active editor, with the create-new fallback when
   none is. Define in `add-result.ts`.
8. **State lib.** Lit context store vs Dyad's `rxjs` subjects. Recommendation: Lit
   context — no new dependency, consistent with the diagram.
9. **`result-ui` independence — tokens & render types.** Both **resolved**. Tokens: the
   `--om-*` sheet + WA bridge live in `@modelica-wrapper/ui-common`, depended on by both
   UIs (no Babylon). Render types: `result-ui` owns its view model in `types.ts`
   (structurally identical to the `omc-client` contract), so the extension bridge passes
   the parsed doc straight onto the component properties with no explicit map — and
   `result-ui` depends on neither `omc-client` nor `diagram-ui`, only `lit` + `echarts` +
   `ui-common`.

## PR breakdown

Sized for independent review; each ships on its own.

| # | Title | Scope | Tests |
| --- | --- | --- | --- |
| **1** ✅ | `resultView` contract + pure helpers + `result-ui` package | omc-client `resultView.ts` (types + schemas); extension `result-doc.ts` (`parse`/`serialize`/`tracesNeedingData`); **new `result-ui` package** with `var-tree.ts` (`buildVariableTree`). Pure; no UI, no host wiring. | Schema accept/reject; round-trip parse/serialize; `buildVariableTree`; `tracesNeedingData` planner. **(43 tests, done)** |
| **2** ✅ | extension: provider skeleton | `ResultViewEditorProvider` + `modelica.resultView` customEditor for `*.omresults`, CSP HTML, `postprocessing-protocol.ts`, **third esbuild target** (`postprocessing.js`/`.css`, no Babylon), `<om-result-view-root>` bridge rendering a placeholder. `ready`→`doc` round-trip + re-sync on edit. Also: host `tsconfig` now type-checks `src/results/`. | typecheck + 3-bundle build; manual: open a `.omresults`, see the shell. |
| **3** ✅ | result-ui: the cards UI | All five `<om-*>` elements + `echart-theme.ts` + pure `chart-option.ts` + `picker.ts`, driven by a hand-built `ResultViewDoc` + mock `TracePayload`s in Storybook. ECharts wired; `lit`/`echarts` deps added; `omTokens` from `ui-common` (no omc-client/diagram-ui dep). result-ui owns its render types in `types.ts`. | Storybook (3 stories) + unit tests: `picker`, `chart-option`, `var-tree`, mount/`om-request-variables`. **(24 tests)** |
| **4** | extension: data path | Lazy `readSimulationResultVars` / `readSimulationResult`, `result-cache.ts` (path+mtime), `requestVariables`, `traceData`, all doc-edit handlers. | Integration against a real `.mat` fixture; plots render end-to-end. |
| **5** | extension: the three add paths | `add-result.ts` — file pick, `.modelica` quick-pick, `modelica.addResultToView` command + `runSimulate` auto-add hook + active-view registry. | Integration: simulate → result appears; pick → appears; cache pick → appears. |
| **6** | polish | rename/remove result, missing-file chip, theme-change refresh, resize, empty states. | Manual smoke + a missing-path unit test. |

PRs 1 and 3 are independently reviewable today. PR 2 is the host scaffold; PR 4
depends on 1 + 2; PR 5 depends on 4; PR 3's UI meets the host at PR 4.

## Bootstrap sequence

Start at **PR 1** and stop at its boundary for review — pure contract, no UI, no host
wiring. As the first step, capture a small `.mat` fixture (run OMC once on a trivial
model, e.g. a ramp `der(x)=1`) and check it into the omc-client test fixtures so PR 4
has a deterministic integration target.

## History / decisions

Decisions taken at the design-phase Q&A (2026-05-22), kept so the "why" survives:

- **Persistence: custom-editor JSON file** (`.omresults`) over an ephemeral panel.
  Git-trackable, diffable, multiple per workspace, undo/redo for free via
  `WorkspaceEdit` — and it matches both Dyad and our file-based ethos (`.modelica`
  cache, persisted `.mo`).
- **Charting: ECharts.** Rich interactions (zoom, legend, tooltip) out of the box at
  ~1 MB, themeable from CSS vars. Chosen over uPlot (lighter/faster but we'd build the
  legend/toolbar) and Plotly (Dyad's choice but ~3 MB and harder to token-theme).
- **v1 cards: plots only.** Markdown/value cards deferred; the `Card` union is left
  open so they need no migration. (Dyad's markdown cards run Julia to compute embedded
  values — we have no equivalent, so static notes would be the most we could match,
  and they add little to a first cut.)
- **Add paths: all three.** Manual file pick, auto-add on Simulate, and `.modelica`
  cache browse — the full "user *or* our code can add any `.mat`" requirement, routed
  through one `modelica.addResultToView` command.
- **Contract placement: split by consumer** (decided while building #82). The first
  cut put the whole thing — schema *and* `parse`/`serialize`/`buildVariableTree`/
  `tracesNeedingData` — in `omc-client/_shared/`, following the `DiagramLayout`
  precedent. But `DiagramLayout`/`ParameterModel` belong there because they're OMC
  *producer outputs*; `ResultViewDoc` is a webview document format with **no** OMC
  producer, so only its *types + schemas* (the wire contract both sides import) stay in
  `omc-client`. The host-only I/O (`parse`/`serialize`/planning) moved to
  `extension/src/results/result-doc.ts` and the webview-only picker tree to
  `result-ui`. omc-client stays about contracts, not file I/O.
- **Shared `ui-common` package** (decided while building #82). The `--om-*` design
  tokens (`omTokens`) and the Web Awesome → VSCode theme bridge (`webawesome-setup` +
  `wa-bridge.css`) were extracted from `diagram-ui/src/base/` into a new
  `@modelica-wrapper/ui-common` package, depended on by both UIs. This is what lets
  `result-ui` reuse the house tokens/theme **without** depending on `diagram-ui` (and
  its Babylon). `diagram-ui` was migrated to import them from `ui-common`; its
  `./webawesome-setup` subpath export moved there too.
- **Dedicated `result-ui` package** (decided while building #82). The webview lives in
  its own package `@modelica-wrapper/result-ui` rather than under
  `diagram-ui/src/postprocessing/`, so it can be bundled and distributed independently.
  This reverses the design's initial "no new package" lean (borrowed from the
  multibody note): the deciding factor is that the postprocessing UI shares **nothing**
  with the Babylon diagram, so folding it into `diagram-ui` would have shipped Babylon
  to a charts-only view. Keeping it separate also forces the clean dependency boundary
  (no `diagram-ui`, ideally no `omc-client`) that independence requires — see
  [risks #9](#open-questions--risks).
