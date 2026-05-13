# MultiBody 3D preview — design

Status: design, pre-implementation. Render-only scope. Roundtrip (3D authoring → `.mo`) is **not** in scope here, but every data-shape decision below is checked against it so the seam stays clean.

## Goal

Show the t=0 spatial configuration of a Modelica `Modelica.Mechanics.MultiBody.*` assembly inside the existing Babylon scene, sharing the same `<om-scene>` and `ArcRotateCamera` as the 2D diagram view. The user sees boxes, cylinders, spheres, file meshes, frame arrows and force/torque vectors positioned in world space — without running a real simulation.

## Non-goals

- Authoring (drag-to-create, palette, frame-connector wiring). Tracked separately under the roundtrip seam below.
- Time-stepping / animation playback of `_res.mat` over a timeline.
- Inverse kinematics / geometric constraint solving (MultiBody has none and we won't invent any).
- Vectors and `Surface` primitives in the first cut — boxes / cylinders / spheres / cones / pipes / wireboxes / file meshes carry most of the value. Vectors land in a follow-up.

## Background — what the research established

Confirmed in the previous research turn (see also memory `reference_omc_modelinstance.md`):

- OMC has a backend stage (`OMCompiler/Compiler/BackEnd/VisualXML.mo`) that walks the **flattened** model and emits `<ModelName>_visual.xml` in `cd()`. It is triggered by `setCommandLineOptions("-d=visxml")` and runs as a side effect of **`translateModel(...)`** — no C compile, no simulation run.
- The XML normalises every MultiBody visualiser (`FixedShape`, `BodyShape`, `FixedTranslation`, `World`, gravity arrows, …) into the single `Modelica.Mechanics.MultiBody.Visualizers.Advanced.{Shape,Surface,Vector}` primitive set. We do **not** re-implement MultiBody inheritance walking — OMC has already done it.
- Each shape scalar slot is an `<exp>` that's either a literal **or** a `<cref>`/`<binary>`/`<call>` referencing a simulation variable. For articulated assemblies (DoublePendulum), joint-state-dependent slots will be dynamic crefs.

For dynamic crefs in a "no-simulation" preview, the cleanest path is **init-only simulate**: `simulate(stopTime=0, numberOfIntervals=1)` runs the initial-equation solve, writes a single-row `_res.mat`, and the renderer resolves dynamic crefs against row 0. We pay for one init solve (≈ 1–3 s warm cache for a typical assembly), no integration time.

## Data path

Three logical layers, all of them pure where possible:

```
OMC (translateModel + simulate stopTime=0)
   ↓                                  ↓
<Model>_visual.xml            <Model>_res.mat (init row only)
   ↓                                  ↓
parseVisualXml(xml)           readResultRowZero(matPath, crefs)
   ↓                                  ↓
   └─────── resolveExpressions ───────┘
                  ↓
           VisualScene (literal-valued shapes/vectors/surfaces)
                  ↓                   ↑
                  └── joinWithModelInstance(mi) ──┘
                  ↓
           MultibodyScene (shapes + componentRef + parameter source)
                  ↓
           <om-multibody-scene> (Babylon meshes)
```

### Producer responsibilities — `packages/omc-client/src/api/multibody/`

A new sub-namespace alongside `api/diagram/`:

| function | level | purpose |
|---|---|---|
| `parseVisualXml(xml)` | pure | XML → `VisualXmlDocument` (record-faithful, expressions still as AST) |
| `resolveExpressions(doc, env)` | pure | walks the AST, substitutes crefs from `env: Map<string, number>`, evaluates `+/-/*//`/`cos/sin/sqrt`. Slots that still reference unknown crefs are flagged `unresolved: true` so the renderer can show a placeholder rather than silently positioning at the origin |
| `produceVisualScene(doc, env)` | pure | combines parse + resolve into `VisualScene` (shapes/vectors/surfaces with literal-valued fields). Renderer-agnostic. |
| `joinWithModelInstance(scene, mi)` | pure | maps each shape's `<ident>` (e.g. `bodyShape1.shape_1`) back to the corresponding `ComponentElement` in the `ModelInstance` tree. Attaches `componentRef` for selection / roundtrip. Shapes that can't be joined (synthetic — `world.gravityArrow.shape_1`, etc.) keep `componentRef: null` |
| `generateVisualization(ctx, {className})` | I/O | OMC orchestration: `setCommandLineOptions("-d=visxml")` → `translateModel` → locate file in `cd()` → read via `fs` → return `{ xml, workingDir }` |
| `initSolve(ctx, {className})` | I/O | `simulate(stopTime=0, numberOfIntervals=1)` → returns `resultFile` path |
| `loadMultibodyScene(ctx, {className})` | I/O | top-level orchestrator: visualization + init-solve + parse + resolve + join. Returns `MultibodyScene` |

XML parsing: `fast-xml-parser` (≈ 30 kB, MIT, already plays nicely with Vite). Validate the parsed object against a Zod schema in `_shared/visualScene.ts` matching the `VisualXMLTpl.tpl` shape (visualization > shape* / vector* / surface*, each with the field set documented in the research).

### Schema (`_shared/visualScene.ts`)

Mirror the existing `diagramLayout.ts` conventions — `.strict()` everywhere, hand-written interfaces for recursive seams, optional fields typed `T | undefined`. Sketch:

```ts
export interface VisualShape {
  kind: "shape";
  ident: string;
  shapeType: string;                  // "box" | "sphere" | "cylinder" | ... | "modelica://Pkg/Resources/foo.stl"
  r: Vec3;                            // world position of frame_a
  T: Mat3;                            // world ← frame_a orientation
  rShape: Vec3;                       // frame_a → shape origin
  lengthDirection: Vec3;
  widthDirection: Vec3;
  length: number;
  width: number;
  height: number;
  extra: number;
  color: [number, number, number];    // 0–255 RGB
  specularCoefficient: number;
  unresolved?: boolean;               // any slot still references an un-evaluated cref
  componentRef?: ComponentRef;        // joined from getModelInstance (null = synthetic shape, e.g. world arrow)
  parameterSource?: ParameterSource;  // forward-looking: which parameters on which component drive this pose
}
```

`ParameterSource` (added in PR1, populated in a later authoring PR) is the seam for roundtrip — see below.

### Caching

`loadMultibodyScene` results keyed by a content hash of the **source file(s)** for the class (taken from `getSourceFile`) so we don't re-translate on every camera nudge. Invalidated on save / loadString. Simple Map in the wrapper layer is fine.

## Render path

### Mesh factory — `packages/diagram-ui/src/multibody/mesh-factory.ts`

One pure function per shape type, taking `(shape: VisualShape, scene: Scene) => Mesh`. Babylon mapping:

| shapeType | Babylon primitive | notes |
|---|---|---|
| `box` | `CreateBox(width, height, length)` | local axes pre-aligned to lengthDir/widthDir |
| `sphere` | `CreateSphere(diameter=length)` | width/height ignored per MSL spec |
| `cylinder` | `CreateCylinder(height=length, diameterTop=width, diameterBottom=width)` | |
| `cone` | `CreateCylinder(diameterTop=0, diameterBottom=width)` | |
| `pipe` | `CreateTube` | inner/outer radius from `extra` (pipe wall ratio) |
| `beam` | custom rounded-rectangle extrusion | low-priority; bounding box fallback OK |
| `wirebox` | `CreateBox` + wireframe material | |
| `gearwheel` | procedural; bounding cylinder fallback for now | |
| URI (`*.stl`, `*.obj`, `*.glb`) | `SceneLoader.LoadAssetContainerAsync` | URI resolved via `uriToFilename` |
| URI (`*.dxf`, `*.3ds`) | bounding box placeholder | no native Babylon loader; revisit |

### Frame composition — `frame-math.ts`

Per shape, world-space transform:

```
worldT = makeTRS(r, T)              // world ← frame_a
shapeOriginT = translate(r_shape)   // frame_a → shape origin
shapeOrientT = orientLengthWidth(lengthDirection, widthDirection)
final = worldT · shapeOriginT · shapeOrientT
```

`orientLengthWidth` builds a 3×3 orientation where x ← lengthDirection, y ← widthDirection, z = x × y. **Note:** the `_visual.xml` `<T>` template emits row-major while Babylon's `Matrix.FromArray` is column-major — transpose on ingest. Add a unit test that pins this.

### Lit elements — `packages/diagram-ui/src/multibody/`

| element | role |
|---|---|
| `<om-multibody-root>` *(exists)* | provides parentNodeContext under `worldRoot` |
| `<om-multibody-scene>` | takes `MultibodyScene` property, renders all shapes/vectors/surfaces |
| `<om-mb-shape>` | renders one shape; consumes parent node context; provides itself as parent (for future labels) |
| `<om-mb-vector>` | renders one arrow (force/torque/gravity) — later PR |
| `<om-mb-frame-axes>` | small red/green/blue triad at a frame origin (joints + world) — later PR |

Selection: identical pattern to 2D — picked mesh `userData.label` carries the `componentRef` from `MultibodyScene.shapes[i]`. The existing `InteractionManager` can be wired up unchanged once shapes carry the same key shape.

### Camera

`<om-scene cameraMode="3d">` already exists (per `Camera3D.stories.ts`). The MultiBody scene story sets it to `"3d"` on mount. The user can flip back to `"2d"` to look top-down — useful for diagrams that mix multibody and signal-domain components.

## Roundtrip seam (forward-looking)

The render path here makes three concessions to a future authoring path so that we don't re-architect later:

1. **`componentRef` on every joinable shape.** Selecting a 3D primitive in the UI immediately gives us the Modelica component it came from. The existing `editing/setComponentModifierValue` write surface is therefore reachable from a 3D click without any new plumbing.
2. **`parameterSource` field reserved on `VisualShape`.** When we add authoring, this slot will be populated with the `{component, modifier-path}` pair whose value drives each pose slot — e.g. for a `FixedTranslation`, `r` is bound directly to `bodyShape1.r`. The expression resolver knows this from the `<cref>` tree (the cref path **is** the parameter path when it's a direct binding). Populating it is a small extension to `resolveExpressions`; reserving the field now keeps the schema stable.
3. **`unresolved: true` rather than silent zero.** Shapes whose pose depends on un-evaluated state crefs render with a dashed bounding box and a "?" label rather than collapsing to the origin. This makes the data-path's coverage gaps observable instead of invisible — and is the same surface that a future authoring path will use when it needs to draw "this body's pose is dynamic, not directly editable here".

Anything beyond these three points (drag-to-create, frame-connector wiring, parameter editing UI for r/R) is its own design — but it depends on **none** of the choices in this doc being changed.

## File / package layout

```
packages/omc-client/src/
  _shared/
    visualScene.ts             # Zod schemas + types: VisualXmlDocument, VisualScene, VisualShape, MultibodyScene
    visualXmlParser.ts         # parseVisualXml + tests
    multibodyScene.ts          # produceVisualScene + joinWithModelInstance + tests
  api/multibody/
    index.ts                   # barrel
    generateVisualization.ts   # OMC + fs
    initSolve.ts               # simulate(stopTime=0)
    loadMultibodyScene.ts      # orchestrator
    fixtures/                  # captured _visual.xml + _res.mat row snippets for tests
      DoublePendulum_visual.xml
      Pendulum_visual.xml
      World_visual.xml

packages/diagram-ui/src/multibody/
  multibody-root.component.ts  # (exists)
  multibody-scene.component.ts # NEW — renders a MultibodyScene
  mb-shape.component.ts        # NEW — one shape
  mesh-factory.ts              # NEW — pure (shape, scene) → Mesh, keyed on shapeType
  frame-math.ts                # NEW — TRS composition + lengthDir/widthDir orientation
  mesh-factory.test.ts
  frame-math.test.ts

packages/diagram-ui/stories/
  Multibody.stories.ts         # NEW — DoublePendulum + a hand-built fixture
  fixtures/
    doublePendulum.multibodyScene.json  # captured MultibodyScene
```

We do **not** create a `multibody` package. The split mirrors the existing 2D layering: data shapes + producer in `omc-client`, Babylon glue in `diagram-ui`. The `diagram-svg` package isn't involved — 3D needs no SVG step.

## Open questions / risks

1. **Cref-expression coverage.** The resolver needs to handle at least `<cref>`, `<binary>` (+/-/* /), `<unary>` (-), `<call>` (cos, sin, sqrt). Verify empirically against `DoublePendulum_visual.xml` + 2–3 other MSL examples before locking the AST.
2. **Working directory.** `_visual.xml` lands in `cd()`. Wrapper must `cd(...)` to a per-call sandbox to avoid clobbering. Use OMC's `cd` builtin or set it before translate.
3. **External-mesh formats.** DXF is common in `Modelica/Resources/Data/Shapes/*` and Babylon can't load it. Acceptable first cut: bounding-box placeholder + URI in the label, with a TODO to plumb a DXF→glTF converter.
4. **`T` matrix order.** Template emits row-major; Babylon ingest is column-major. Pin with a test (a known-rotated cube fixture).
5. **`getModelInstance` ↔ shape `<ident>` matching.** Idents look like `bodyShape1.shape_1` or `world.shape_1`. The join rule is "first dotted-path segment is a component name in `mi.elements[]`". Verify on a model with nested compositions (e.g. a `BodyShape` inside a sub-model).
6. **Init-solve failure modes.** Some MSL examples have `experiment(StartTime=…)` ≠ 0 or require specific solver options. If `simulate(stopTime=0)` fails, fall back to rendering only literal-valued shapes and flagging the rest `unresolved`.

## PR breakdown

Sized for independent review; each PR is shippable on its own (no UI changes broken between them).

| # | Title | Scope | Tests |
|---|---|---|---|
| **1** | `omc-client`: visual-scene data path | `visualScene.ts`, `visualXmlParser.ts`, `multibodyScene.ts`. Pure-logic only — no UI, no OMC orchestration. The expression resolver covers literal + the common cref/binary/call set. | Captured `_visual.xml` fixtures parsed end-to-end into a typed `VisualScene`; join with a captured `getModelInstance` JSON for the same model |
| **2** | `omc-client`: OMC orchestration | `generateVisualization`, `initSolve`, `loadMultibodyScene`, sandboxed `cd`, content-hash cache. Depends on PR 1. | Integration test against a real OMC if available; otherwise mocked `CallContext` and golden-file comparison |
| **3** | `diagram-ui`: mesh factory + frame math | Pure functions, no Lit. Babylon mesh creation per shape type (boxes/spheres/cylinders/cones/pipes/wirebox + bounding-box fallback). | NullEngine vitest: every shape type creates a mesh with expected `getBoundingInfo`; `T` row-major→column-major round-trip pinned |
| **4** | `diagram-ui`: `<om-mb-shape>` + `<om-multibody-scene>` | Lit elements; consume MultibodyScene; mount under `<om-multibody-root>`. Storybook story rendering a hand-built `MultibodyScene` fixture (no OMC). | NullEngine vitest: scene with 2 shapes produces 2 TransformNodes parented under the multibody root; disconnect disposes |
| **5** | `extension`: webview wiring + caching | Pipe `loadMultibodyScene` through the existing webview message bus; cache by source-file hash; toggle for 2D / 3D / split view. | Manual smoke test on `DoublePendulum` and `World` |
| **6** | File-mesh loader | URI resolution via `uriToFilename`; STL/OBJ via Babylon `SceneLoader`; DXF bounding-box fallback. | NullEngine vitest with a small STL fixture; URI resolution unit tested |
| **7** | Vectors + frame axes | `<om-mb-vector>` + `<om-mb-frame-axes>`; arrows for forces/torques/gravity; coordinate triads at frames. | Story + NullEngine vitest |
| **8** | Selection wire-up | Walk `pickedMesh.parent` up to a node labelled with `componentRef`; reuse `InteractionManager`. End-to-end "click box → select Modelica component". | NullEngine + simulated pick |

PRs 1, 3 are independently reviewable today. PR 2 depends on PR 1. PR 4 depends on PRs 1 + 3. The rest stack onto PR 4.

## Bootstrap sequence

The implementation agent should pick up at **PR 1** and stop for review at its boundary — no UI changes, no OMC orchestration. The fixtures (captured `_visual.xml` from `DoublePendulum` and `World`) can be produced by running OMC manually with `-d=visxml` once and checking the artifact into `api/multibody/fixtures/`. The agent is expected to do that capture as the first step.
