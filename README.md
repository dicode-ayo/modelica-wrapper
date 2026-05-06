# Modelica VSCode Extension — Starter Notes

A graphical model editor and simulation runner for Modelica, delivered as a VSCode extension. Backed by OpenModelica (OMC) for compilation/simulation and OMSimulator for FMU co-simulation.

-----

## Goals

- **UI editor** — diagram and icon view with drag-and-drop component placement, connection drawing, parameter editing. Feature parity with OMEdit’s modeling surface, in a webview.
- **Run capabilities** — translate, simulate, export FMU, run composed FMU systems. Stream progress and results back to the editor.
- **Single-binary backend** — ship one native executable with the extension; no Python, no Java.
- **Cross-platform** — Windows, macOS, Linux, x64 and arm64.

-----

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  VSCode Extension (TypeScript)                          │
│  ┌──────────────┐    ┌─────────────────────────────┐    │
│  │ Extension    │◄──►│ Webview (React/Svelte)      │    │
│  │ host         │    │ — diagram canvas, forms     │    │
│  └──────┬───────┘    └─────────────────────────────┘    │
└─────────┼───────────────────────────────────────────────┘
          │ JSON-RPC 2.0 over stdio
          ▼
┌─────────────────────────────────────────────────────────┐
│  Backend server (Rust) — single binary                  │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ Annotation     │  │ FMU runtime  │  │ liboms FFI  │  │
│  │ parser         │  │ (dlopen)     │  │ (bindgen)   │  │
│  └────────────────┘  └──────────────┘  └─────────────┘  │
│  ┌────────────────────────────────────────────────────┐ │
│  │ OMC client (ZMQ)                                   │ │
│  └────────────────┬───────────────────────────────────┘ │
└─────────┬─────────┼─────────────────────────────────────┘
          │         │
          ▼         ▼
   user .mo files   omc --interactive=zmq  (OS-installed subprocess)
```

### Three communication legs

1. **Webview ↔ Extension host** — `postMessage`. Webview is sandboxed; don’t try to give it direct backend access (CSP fight).
1. **Extension host ↔ Backend** — JSON-RPC 2.0 over stdio. Same transport VSCode uses for language servers. Libraries: `vscode-jsonrpc` (TS), `lsp-server` or `jsonrpc-stdio-server` (Rust).
1. **Backend ↔ OMC** — ZeroMQ via `omc --interactive=zmq`. OMC is **not** linkable as a library — it’s a 100MB+ MetaModelica binary with an RPC API only.

-----

## Why Rust for the backend

- **Cleaner FFI** to liboms via `bindgen` — auto-generated bindings.
- **Tight FMU stepping loops** matter; `cgo`’s call overhead is real.
- **`serde` + `tree-sitter` + `nom`** for schema-typed protocols and proper Modelica annotation parsing.
- **Smaller distributable** — no runtime to ship.

Pick Go instead only if the team already writes Go or if many concurrent simulations are a primary use case (goroutines beat tokio for that specific pattern).

-----

## What’s linkable, what isn’t

|Component      |Strategy                                                                                      |
|---------------|----------------------------------------------------------------------------------------------|
|OMC (compiler) |**Subprocess** — `omc --interactive=zmq`. No library form exists.                             |
|OMSimulator    |**Static link / FFI** — `liboms` with `oms.h`. Clean C API.                                   |
|FMU runtime    |**`dlopen` at runtime** — every FMU is a shared library per the FMI spec. Use the `fmi` crate.|
|Modelica parser|**In-process** — `tree-sitter-modelica` for IDE features without OMC round-trips.             |
|MAT/CSV results|**In-process** — small crates exist; result files are simple.                                 |

-----

## OMC API surface to wrap

From reading `OpenModelica/OMEdit/OMC/OMCProxy.h`. ~80 calls; the backend wraps these and exposes a typed RPC layer above.

**Browsing** — `getClassNames`, `searchClassNames`, `getClassInformation`, `isPackage`, `getInheritanceCount`, `getInheritedClasses`, `getUses`, `existClass`.

**Reading model contents** — `getComponents`, `getComponentAnnotations`, `getConnectionCount` + `getNthConnection` + `getNthConnectionAnnotation`, `getTransitions`, `getInitialStates`, `getIconAnnotation`, `getDiagramAnnotation`, `getDocumentationAnnotation`, `listFile`, `instantiateModel`.

**Parameters / modifiers** — `getParameterValue`, `getComponentModifierNames/Value/Values`, `setComponentModifierValue`, `removeComponentModifiers`, `getExtendsModifierNames/Value`, `setExtendsModifierValue`.

**Editing** — `addComponent`, `deleteComponent`, `renameComponent`, `updateComponent` (placement annotations), `addConnection`, `deleteConnection`, `updateConnection`, `addTransition` / `deleteTransition`, `addClassAnnotation`, `setComponentProperties`, `setComponentDimensions`, `setComponentComment`.

**Lifecycle** — `loadFile`, `loadString`, `loadModel`, `parseFile`, `createClass`, `createSubClass`, `renameClass`, `deleteClass`, `copyClass`, `moveClass[ToTop|ToBottom]`, `getSourceFile`, `setSourceFile`, `diffModelicaFileListings`.

**Execution** — `checkModel`, `translateModel`, `buildModel`, `simulate`, `buildModelFMU(className, version, type, prefix, platforms)`, `translateModelXML`, `importFMU`, `getSimulationOptions`, `isExperiment`.

**Solver/runtime config** — `getSolverMethods`, `getJacobianMethods`, `getInitializationMethods`, `getLinearSolvers`, `getNonLinearSolvers`, `setMatchingAlgorithm`, `setIndexReductionMethod`, `setCommandLineOptions`.

**Results** — `readSimulationResultSize`, `readSimulationResultVars`, `closeSimulationResultFile`.

-----

## Persistence model

OMC mutates an **in-memory AST** when you call `addComponent`, `updateComponent`, etc. The .mo file on disk is unchanged until something writes it. Two options for save:

- **Option A — let OMC save**: call OMC’s `save(className)` after edits. Simpler. Loses control over encoding, formatting, line endings, atomic writes.
- **Option B — backend owns the write** (OMEdit’s pattern): call `listFile(className)` to get pretty-printed source, write it ourselves, then `setSourceFile(className, path)` to tell OMC where it now lives.

**We’ll use Option B.** Reasons: encoding control, atomic writes, Git/file-watcher integration, and it’s the only option if backend and user files end up on different hosts (remote dev, containers).

Track per-class dirty state. OMEdit uses an `mIsSaved` flag flipped to false on every mutation. Mirror that.

OMC has no file watcher. If a .mo changes on disk externally (Git pull, another editor), detect it and call `loadFile` again.

-----

## JSON-RPC protocol sketch

Three method families, all schema-typed via `serde` and TypeScript types generated from a shared schema.

```typescript
// === Browsing (cheap, cacheable) ===
"model.getClasses"          → string[]
"model.getClassInfo"        → ClassInfo
"model.getIconAnnotation"   → ParsedIcon          // already parsed server-side
"model.getDiagramElements"  → Element[]           // components + connections + shapes
"model.getComponents"       → ComponentInfo[]

// === Editing (mutating) ===
"model.addComponent"        → Ok | Error
"model.updateComponent"     → Ok | Error          // placement annotation
"model.deleteComponent"     → Ok | Error
"model.addConnection"       → Ok | Error
"model.deleteConnection"    → Ok | Error
"model.setModifierValue"    → Ok | Error
"model.save"                → Ok | Error

// === Execution (some streaming) ===
"sim.check"                 → Diagnostic[]
"sim.translate"             → { artifacts: string[] }
"sim.run"                   → streamed: { progress, stdout, results }
"sim.exportFMU"             → { fmuPath }
"oms.simulate"              → streamed (composed FMU systems)
"results.read"              → { vars: string[], series: number[][] }
```

Streaming uses JSON-RPC notifications (server → client) during long-running ops.

-----

## Annotation parsing

OMEdit’s `StringHandler::getStrings()` is positional, brittle splitting on the strings OMC returns from `getIconAnnotation` etc. **Don’t copy this approach.** Single biggest source of inherited bugs if done naively.

Our approach: a small recursive-descent parser turns OMC's response strings into a tagged-union `Value` tree (`StringV`/`BoolV`/`IntV`/`FloatV`/`IdentV`/`ListV`/`CallV`/`NullV`). Then a typed-traversal layer reads each shape's positional arguments **directly from Modelica spec §18.6** and emits typed `Shape` records. No regex splitting, no string fragility — argument order comes from the spec, not from probing OMC and inferring.

Five shape primitives to support, all inheriting `GraphicItem` (origin, rotation, visible) + `FilledShape` (lineColor, fillColor, linePattern, fillPattern, lineThickness):

- `Line` — also represents connections and transitions
- `Rectangle` — borderPattern, radius
- `Ellipse` — startAngle, endAngle
- `Polygon` — smooth
- `Text` — font, alignment, dynamic `String(...)` args
- `Bitmap` — fileName + base64 imageSource

Plus `Placement(transformation = ..., iconTransformation = ...)` math from Modelica spec §18 — extent → rotation → origin compose order.

-----

## What we write vs. what we use

**Write ourselves (Rust):**

- Annotation parser (~500 LOC, all 5 shape types)
- Placement/Transformation math (spec §18)
- Thin OMC client (~30 method wrappers, ~600 LOC)
- JSON-RPC server scaffolding (~100 LOC)
- Dirty tracking, file save logic, file watcher

**Write ourselves (TypeScript):**

- Webview diagram canvas — React + Konva, or Svelte + raw SVG
- Property panels, library tree, results plotting
- Extension activation, command registration, RPC client

**Don’t write:**

- A Modelica compiler — use OMC
- A DAE solver — use FMU + stepping loop
- An FMU loader — `fmi` crate
- An MAT result parser — crate exists
- A JSON-RPC framework — `lsp-server` / `vscode-jsonrpc`

-----

## Repo layout

```
modelica-vscode/
├── extension/                    # TypeScript, packaged as .vsix
│   ├── src/
│   │   ├── extension.ts          # activate(), command registration
│   │   ├── client.ts             # JSON-RPC client, spawns backend
│   │   ├── webview/              # React app — diagram editor
│   │   └── schema.ts             # generated from Rust types
│   └── package.json
├── backend/                      # Rust workspace
│   ├── Cargo.toml
│   ├── crates/
│   │   ├── server/               # JSON-RPC entry point, main.rs
│   │   ├── omc-client/           # ZMQ client + OMC API wrappers
│   │   ├── annotations/          # nom-based annotation parser
│   │   ├── oms-sys/              # bindgen FFI to liboms
│   │   ├── fmu-runner/           # FMU stepping loop
│   │   └── results/              # MAT/CSV reader
│   └── schema/                   # JSON schemas → TS codegen
├── shared/
│   └── proto.json                # canonical RPC schema
└── docs/
```

-----

## Roadmap

**Milestone 1 — read-only browser**

- Spawn `omc --interactive=zmq`, wrap `getClasses` / `getClassInfo` / `getComponents`.
- Render icon view in webview from parsed annotations.
- Click a class in the tree → see its icon. No editing.

**Milestone 2 — diagram view + editing**

- Render diagram view (components + connections + shapes).
- Drag-to-place: `addComponent` with placement annotation.
- Draw connection: `addConnection`.
- Parameter editor: `setComponentModifierValue`.
- Save flow with dirty tracking.

**Milestone 3 — execution**

- `sim.check`, `sim.translate`, `sim.run` with streamed progress.
- Results panel reading .mat files, plot variables.
- FMU export via `buildModelFMU`.

**Milestone 4 — OMSimulator integration**

- Link liboms.
- Second editor mode for SSP/FMU composition.
- Co-simulation runner.

**Milestone 5 — polish**

- Undo/redo (mirror OMEdit’s `Commands.cpp` list).
- Library browser with search.
- File watcher → auto-reload on external changes.
- Cross-platform packaging.

-----

## Sharp edges to plan for

- **OMC startup is slow** (1–3 seconds). Spawn lazily on first model open, keep alive across the session.
- **OMC is single-threaded.** Long calls block all other RPC. Queue requests; show progress to the user; never call OMC from inside an RPC handler that needs to be quick.
- **Annotation strings come back as nested Modelica syntax**, not JSON. Parse properly.
- **OMC’s `save` API exists but OMEdit deprecated it.** Don’t use it; reasons listed in the persistence section above.
- **No file watching in OMC.** Build it ourselves on top of `notify` (Rust) → call `loadFile` on external changes.
- **FMU platform binaries** — the FMU you export only contains the platform binaries you asked for. Document this; the “one FMU runs everywhere” assumption is wrong.
- **liboms version mismatches** with OMC version. Lock both.

-----

## Open questions

- Bundle OMC with the extension, or require user-installed? (Bundling = ~150MB extension. Required-install = friction but standard.)
- Webview rendering: Konva (canvas, fast) vs SVG (better accessibility, easier debug)?
- Should the extension support remote dev / WSL / containers from day one? Affects backend packaging.
- License: OMC is OSMC-PL/GPL-dual. Extension can be MIT but distribution implications need a lawyer’s eye if we bundle.

-----

## References

**Audit runbook (run an agent against the omc-client package periodically):**

- [`packages/omc-client/docs/audit.md`](packages/omc-client/docs/audit.md) — read-only consistency check between our wrappers and the upstream OMC scripting docs. Run it as: "audit the omc-client package using `packages/omc-client/docs/audit.md`."

**Authoritative — read these before reverse-engineering anything:**

- **OpenModelica.Scripting API reference** (auto-generated from OMC source, lists every function's return type as a Modelica signature): <https://build.openmodelica.org/Documentation/OpenModelica.Scripting.html>
- **Modelica specification ch. 18 — Annotations** (§18.6 lists the exact positional-argument order for every shape primitive — transcribe from here, do not guess): <https://specification.modelica.org/maint/3.6/annotations.html>

**Reference implementations (parser/client cross-checks):**

- **OMPython** (de-facto reference parser, `OMTypedParser.py` uses pyparsing): <https://github.com/OpenModelica/OMPython>
- **OMJulia.jl** (Julia client, second perspective on parser behavior): <https://github.com/OpenModelica/OMJulia.jl>
- **OMEdit source** (the reference graphical editor we’re learning UI flows from; do **not** copy `StringHandler::getStrings()`): <https://github.com/OpenModelica/OMEdit>

**Project / ecosystem:**

- OpenModelica source: <https://github.com/OpenModelica/OpenModelica>
- FMI standard: <https://fmi-standard.org/>
- OMSimulator: <https://github.com/OpenModelica/OMSimulator>
- tree-sitter-modelica (for in-process `.mo` IDE features later — not used yet): <https://github.com/OpenModelica/tree-sitter-modelica>
