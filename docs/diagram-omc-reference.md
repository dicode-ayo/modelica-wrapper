# Diagram & library tree — OMC/OMEdit reference + our implementation

[← back to README](../README.md) · related:
[diagram-rendering.md](diagram-rendering.md) · [protocol.md](protocol.md) ·
[architecture.md](architecture.md) · [omc-client.md](omc-client.md)

The full picture for the **graphical diagram/icon editor** and the **library
tree**: the authoritative OMC/OMEdit reference (from a deep-research pass over
the Modelica spec + OpenModelica source) on one side, and **what we actually
implement today** (with file links) on the other — plus a frank gaps table for
the editor work still ahead. This is a *reference for future agents*, not a
design proposal.

> **Two durability tiers in the reference.** The **Modelica-spec** facts
> (coordinate system, `Placement`/`Transformation` order, `GraphicItem`,
> `extends` composition, connection `Line` grammar, `getClassNames`/
> `getModelInstance` signatures) are *normative* and stable across 3.4→master.
> The **OMEdit C++ wiring** facts (file paths, exact method names, the
> `scale(1,-1)` flip) track current `master` and drift across releases. Treat
> the first as load-bearing, the second as illustrative.

## Cast of characters (ours)

| Layer | Symbol | File |
| --- | --- | --- |
| Fetch + orchestrate read | `fetchLayout()`, edit/undo handlers | [open-diagram.ts](../packages/extension/src/diagram/open-diagram.ts) |
| OMC graphics source | `getModelInstance()` | [api/contents/getModelInstance.ts](../packages/omc-client/src/api/contents/getModelInstance.ts) |
| Instance AST schema (Zod) | `modelInstance.ts` | [_shared/modelInstance.ts](../packages/omc-client/src/_shared/modelInstance.ts) |
| JSON→layout (pure) | `produceDiagramLayout()` | [api/diagram/producer.ts](../packages/omc-client/src/api/diagram/producer.ts) |
| Renderer-agnostic contract | `DiagramLayout` | [_shared/diagramLayout.ts](../packages/omc-client/src/_shared/diagramLayout.ts) |
| Shape decode | `decodeShape()` | [api/diagram/shapes.ts](../packages/omc-client/src/api/diagram/shapes.ts) |
| Placement transform | §18 extent→rotation→origin | [api/diagram/placement.ts](../packages/omc-client/src/api/diagram/placement.ts) · [diagram-ui base/placement-math.ts](../packages/diagram-ui/src/base/placement-math.ts) |
| Babylon renderer | `<om-scene>` / `<om-graphical-layout>` | [diagram-ui/src/scene](../packages/diagram-ui/src/scene/scene.component.ts) · [graphical-layout](../packages/diagram-ui/src/graphical-layout/graphical-layout.component.ts) |
| SVG renderer (icons) | `renderIconLayersToSvg()` | [packages/diagram-svg/src](../packages/diagram-svg/src) |
| Layout diff / write-back | `diffLayouts()`, `applyEdits()` | [diff-layout.ts](../packages/extension/src/diagram/diff-layout.ts) · [apply-edits.ts](../packages/extension/src/diagram/apply-edits.ts) |
| Undo | `SnapshotStack`, `captureSnapshot()` | [snapshot-stack.ts](../packages/extension/src/diagram/snapshot-stack.ts) · [omc-snapshot.ts](../packages/extension/src/diagram/omc-snapshot.ts) |
| Library sidebar | `LibraryWebviewProvider` | [library/library-webview-provider.ts](../packages/extension/src/library/library-webview-provider.ts) |
| Library data source | `LibrarySource` | [diagram/library-source.ts](../packages/extension/src/diagram/library-source.ts) |
| Host↔webview wire | message catalog | [webview/protocol.ts](../packages/extension/src/webview/protocol.ts) |

---

## 1. Graphics data source

**Reference.** The modern OMC source is **one call**:
```
getModelInstance(className, context = $Code(__NoContext), modifier = "", prettyPrint = false) → String (JSON)
```
"Dumps a model instance as a JSON string" — the full instance/graphics tree
(elements, coordinate systems, graphics, placements, connections), with
inheritance already elaborated. `getModelInstanceAnnotation` is the same JSON
filtered to annotations (cheap, for thumbnails). The **older** path still exists
as distinct calls — `getIconAnnotation` / `getDiagramAnnotation` (→ `Expression`)
and `getConnectionList` (→ `String[:,:]`). Current OMEdit is documented to use
the `getModelInstance` JSON path; a claim that master OMEdit still parses the old
per-annotation string lists was **refuted 0-3**.

**Ours — matches the reference.** We fetch via
[`getModelInstance`](../packages/omc-client/src/api/contents/getModelInstance.ts)
(validated by the hand-rolled Zod schema in
[`modelInstance.ts`](../packages/omc-client/src/_shared/modelInstance.ts) — **this
schema is the concrete JSON shape we rely on**; the upstream JSON keys were an
*open question* the research couldn't pin from primary source, so our schema is
the working contract), and use the cheap
`getModelInstanceAnnotation` for library thumbnails. The pure
[`produceDiagramLayout()`](../packages/omc-client/src/api/diagram/producer.ts)
walks that AST → [`DiagramLayout`](../packages/omc-client/src/_shared/diagramLayout.ts)
(icon/diagram layers, deduped class catalog, components, connectors,
connections), walking the `extends` chain and gating conditional components via
`isConditionTrue()`.

---

## 2. Coordinate system & annotation semantics (normative — the gold)

This section is spec-normative and is where "behaves weirdly" bugs usually hide.

- **Coordinate system.** `CoordinateSystem(extent, preserveAspectRatio = true,
  initialScale = 0.1, grid[2])`. **Default `extent = {{-100,-100},{100,100}}` for
  BOTH icon and diagram layers.** First point is left-lower, second right-upper;
  first must be strictly less than second. A dropped component's default size is
  `initialScale ×` the class's coordinate-system size.
- **Y-axis.** Modelica is **y-up**. Screen/Qt is **y-down** — OMEdit inverts the
  scene with `scale(1.0, -1.0)` (Qt has no native inverted-Y). Our renderers do
  the same flip at the scene root (`<g transform="scale(1,-1)">` in SVG, implicit
  in Babylon) — see [placement-math.ts](../packages/diagram-ui/src/base/placement-math.ts).
- **Component `Placement`.** Carries `transformation` (diagram layer) **and**
  `iconTransformation` (icon layer). **If no `iconTransformation` is given,
  `transformation` is reused for the icon layer** — a real rule worth verifying
  in our code.
- **`Transformation(extent, rotation = 0, origin = {0,0})` — applied in the
  fixed order `extent → rotation → origin`:**
  1. the component icon's extent is mapped to the `extent` rectangle (shift +
     scale + flip),
  2. **`rotation` is CCW around `{0,0}` — NOT around the `origin` attribute**,
  3. `origin` then shifts `{0,0}` to the origin point.
  An `extent` with `x2<x1` flips horizontally, `y2<y1` vertically, about the
  object's centre; operations apply in order **scaling, flipping, rotation**.
- **The two-rotation-centres gotcha.** `Transformation.rotation` (component
  placement) rotates around `{0,0}`. But every **`GraphicItem.rotation`**
  (per-primitive: Line/Rect/…) rotates **CCW around that item's own `origin`
  attribute**. These are *different centres*. Mixing them up is a classic source
  of "rotated shape lands in the wrong place." Verify
  [placement.ts](../packages/omc-client/src/api/diagram/placement.ts) /
  [placement-math.ts](../packages/diagram-ui/src/base/placement-math.ts) honour
  both centres distinctly.
- **`GraphicItem`** base fields: `visible = true`, `origin = {0,0}`,
  `rotation(unit="deg") = 0`. Primitives: `Line` (points, color, pattern,
  thickness, arrows, smooth), `Polygon`, `Rectangle`/`Ellipse` (extent, fill),
  `Text` (extent, textString, font, alignment), `Bitmap` (extent, fileName or
  base64 imageSource).

---

## 3. Icon vs Diagram layer, inheritance, conditional graphics

- **Two layers.** Icon layer = the symbol shown when the class is *used as a
  component* in a parent diagram; Diagram layer = the editable internals. A
  component in a parent's diagram is drawn using its type's **icon** layer,
  placed by the component's `transformation`.
- **Inheritance composition (normative).** Base-class graphics are drawn
  **behind** the current class's primitives; multiple base classes order
  **back-to-front by `extends`-clause order**; primitives within a class draw in
  order of appearance. `IconMap`/`DiagramMap` on an `extends` clause can remap the
  base coordinate system (non-default `extent`) or, with
  `primitivesVisible = false`, **hide base graphical primitives while keeping
  inherited components and connections visible**.
- **`DynamicSelect`.** Conditional/parameter-driven graphics
  (`DynamicSelect(static, dynamic)`) — *open question*: the research did not pin
  how OMEdit evaluates these or how they appear in `getModelInstance` JSON.
  Likely an area we don't handle.
- **Icon rotation edge case (`ModelicaSpecification#2248`, open).** Today tools
  **do** rotate/flip a component's icon graphics with its placement on
  90/180/270° / flip; there's an *open* enhancement to keep *quadratic* icons
  upright (Simulink-like). A faithful renderer reproduces today's
  rotate-with-component behaviour.

**Ours.** [`produceDiagramLayout()`](../packages/omc-client/src/api/diagram/producer.ts)
composes inherited icon/diagram layers ancestor-first via `walkLayerEntries()` in
[`walker.ts`](../packages/omc-client/src/api/diagram/walker.ts);
[render-shape.ts](../packages/diagram-ui/src/primitives/render-shape.ts)
`renderLayers()` flattens `IconLayer[]` to z-ordered primitives.
`walkLayerEntries` reads `IconMap`/`DiagramMap.primitivesVisible` from each
`extends` clause annotation and propagates suppression to all deeper ancestors.
**Not handled / verify:** `IconMap`/`DiagramMap` coordinate-system remapping
(non-default `extent`), `DynamicSelect`, the `iconTransformation`-fallback rule,
and the two-rotation-centres distinction.

---

## 4. Connections

**Reference.** A connection's routing is a **`Line` primitive's `points`** inside
the `connect(...)` annotation, optionally with a `Text` primitive:
```modelica
connect(a.x, b.x) annotation(Line(points={{-25,30},{10,30},{10,-20},{40,-20}}));
```
The `Text` may reference a `Line` point by **index** (`1,2,3,…`; `-1` = last) and
use the `%first` / `%second` macros for the connected connectors. OMEdit writes
connections with `OMCProxy::addConnection(start, end, parentClass,
"annotate=" + shapeAnnotation)` (the 4th arg carries the `Line` graphics).
Historically (`#2450`) OMEdit deliberately **skipped** port-compatibility
validation at connect time and surfaced errors only on simulate; v1.21.0
(`PR #10704`) re-added some connect-time type checking.

**Ours.** Connections are read from the instance, kept only when they carry an
`annotation.Line` (bare `connect(...)` is skipped). `ConnectionLayout` carries
the full `Line` style — `waypoints`, `color`, `thickness`, `pattern`, `arrow`,
`arrowSize`, `smooth` — not just the route (issue #219). Write-back lives in
[apply-edits.ts](../packages/extension/src/diagram/apply-edits.ts):
`connectionAdded → addConnection`, `connectionDeleted → deleteConnection`,
`connectionWaypoints → updateConnection`, `connectionRenamed →
updateConnectionNames` (vector-port re-index). Both `addConnection` and
`updateConnection` replace the whole `Line(...)` annotation, so
[diffLayouts()](../packages/extension/src/diagram/diff-layout.ts) carries the
connection's style alongside its waypoints on `connectionAdded`/
`connectionWaypoints` edits and `lineAnnotation()` re-emits every set field —
otherwise a waypoint-only edit (e.g. a component drag re-routing an adjacent
connection) would silently strip a hand-authored style. `connectionRenamed`
doesn't touch the annotation, so it's unaffected. **Fragile:** the vector-port
re-index detection (`connectionRenamed`) is a noted greedy-loop/cascade-shift
risk (issue #76). `<om-line>` now renders `arrow`/`arrowSize` (issue #219 P2);
connections themselves still render via the edge builder, not `<om-line>`, so
a connection's own arrow styling isn't drawn yet — tracked in #219's P3.

---

## 5. Library tree

**Reference.** Built from **`getClassNames`**:
```
getClassNames(class_ = $Code(AllLoadedClasses), recursive=false, qualified=false,
              sort=false, builtin=false, showProtected=false, includeConstants=false) → TypeName[]
```
OMEdit calls it **bare** for top-level/system libraries and with
`(parentName, recursive=true, qualified=true)` to enumerate a class's children —
supporting both lazy single-level and eager recursive population. Restriction via
`getClassRestriction`, metadata via `getClassInformation`. (Claims that OMEdit
lazily caches `getElements` per item behind an `mComponentsLoaded` flag were
**not confirmed** — 1-2.)

**Ours.** [`LibraryWebviewProvider`](../packages/extension/src/library/library-webview-provider.ts)
backs the library sidebar webview: root → `getLoadedLibraries()` +
`getClassNames({sort:true})`; expansion → `getClassNames({typeName, sort:true})`;
restriction per child via `getClassRestriction`.
[`LibrarySource`](../packages/extension/src/diagram/library-source.ts)
adds `searchClassNames` (capped at 80) and session-cached restrictions; icons are
lazy per row via the cheap `getModelInstanceAnnotation` path.

---

## 6. Editing — what we do vs the write-back calls

| Operation | Our edit kind | OMC write | Status |
| --- | --- | --- | --- |
| Move / resize component | `componentPlacement` | `updateComponent(…, placementAnnotation)` | ✅ (placement from view-centre on add, not pixel-precise) |
| Delete component | `componentDeleted` | `deleteComponent` | ✅ |
| Add component (library→canvas) | — | `addComponent` | ✅ via `onAddComponent`, position = view centre; `isPartial` refuses `partial` classes before the write (issue #277) |
| Connection add/delete/reroute | `connectionAdded/Deleted/Waypoints` | `addConnection`/`deleteConnection`/`updateConnection` | ✅ (drag *existing* waypoints only; `Line` style round-trips alongside the route, issue #219) |
| Vector-port re-index | `connectionRenamed` | `updateConnectionNames` | ⚠️ fragile (cascade-shift risk) |
| Component params | — | `setElementModifierValue` | ✅ [parameter-edits.ts](../packages/extension/src/diagram/parameter-edits.ts) |
| Class params | — | `setParameterValue` / `setExtendsModifierValue` | ✅ |
| Change component class | — | `setElementType` | ✅ [open-diagram.ts](../packages/extension/src/diagram/open-diagram.ts) `pickClassToSwap` — candidates filtered by connection compatibility (issue #239, see below) |
| Reset to defaults | — | `removeElementModifiers(keepRedeclares)` | ✅ [clear-modifiers.ts](../packages/extension/src/diagram/clear-modifiers.ts) |
| Undo | snapshot | `listFile`+`getSourceFile` / `loadString` restore | ✅ [snapshot-stack.ts](../packages/extension/src/diagram/snapshot-stack.ts) |

**Change-class candidate filtering** ([change-class-filter.ts](../packages/extension/src/diagram/change-class-filter.ts), issue #239). `setElementType` swaps a component's class even when the new class drops a connector its existing `connect()` equations reference, leaving dangling connections. `pickClassToSwap` keeps only candidates that expose a matching port (name + connector type) for every currently-connected port. Each candidate's ports come from a cached `getElements` walk over its extends chain — never `getModelInstance`, which never returns for builtins like `String` and would stall the shared OMC socket. `getElements` reports only locally-declared elements and omits `extends` rows, so the chain is walked explicitly.

**Missing / not implemented** (vs a full graphical editor):
- **Icon/diagram graphics editing** — shapes are **read-only**; no add/move/delete
  of `Line`/`Rect`/… primitives, no curve editing.
- **Interactive rotate** (no handle/shortcut; rotation only via programmatic
  layout diff) and **flip/mirror** (`applyFlip` exists but is unreachable).
- **Waypoint insert/delete** (only drag existing); no routing-style control.
- **Connector (port) add/delete/move.**
- **Copy/paste**; **multi-select UI** (selection *state* is tracked, no
  affordance); rounded-rectangle corners (renderer parity TODO).
- **Component-level parameter label `%value` substitution** (deferred half of
  issue #28 — only host-level params substitute today).

**Behaves-weirdly suspects** (cross-referenced with §2/§3 reference):
1. **Two rotation centres** — if `GraphicItem.rotation` (around item `origin`) and
   `Transformation.rotation` (around `{0,0}`) are conflated, rotated primitives
   land wrong. **Check [placement.ts](../packages/omc-client/src/api/diagram/placement.ts).**
2. **`iconTransformation` fallback** — if absent, must reuse `transformation`;
   missing this misplaces components that only specify the diagram-layer
   transform.
3. **`IconMap`/`DiagramMap` + `primitivesVisible`** — inherited graphics that
   remap or hide base primitives will render wrong if unhandled.
4. **`DynamicSelect`** graphics — likely rendered statically or dropped.

---

## Open questions (research could not pin)

- The **exact `getModelInstance` JSON key structure** (ModelInstance / Element /
  Connection / Source tree, where `coordinateSystem`/`graphics`/`placement` live,
  how redeclared elements appear). Our [Zod schema](../packages/omc-client/src/_shared/modelInstance.ts)
  is the de-facto contract; reconcile it against a live dump when in doubt.
- Current signatures for `addComponent`/`updateComponent`/`deleteComponent` and
  `setElementModifierValue` (only `addConnection` was line-verified upstream).
- How `DynamicSelect`/conditional graphics are represented in the JSON.

## Sources

**Normative (durable):**
- [Modelica spec — annotations (master)](https://specification.modelica.org/master/annotations.html) · [v3.4 Ch.18](https://specification.modelica.org/v3.4/Ch18.html)
- [OMC scripting API — Users Guide](https://openmodelica.org/doc/OpenModelicaUsersGuide/latest/scripting_api.html) · [getClassNames](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getClassNames.html) · [getClassRestriction](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getClassRestriction.html)
- [ModelicaSpecification#2248 — icon rotation](https://github.com/modelica/ModelicaSpecification/issues/2248) · [#1831](https://github.com/modelica/ModelicaSpecification/issues/1831)

**OMEdit C++ wiring (version-drift):**
- [ModelWidgetContainer.cpp](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Modeling/ModelWidgetContainer.cpp) (the `scale(1,-1)` flip, `addConnection`) · [ShapeAnnotation.cpp](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Annotations/ShapeAnnotation.cpp)
- [LibraryTreeWidget.cpp](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Modeling/LibraryTreeWidget.cpp) · [OMCProxy.cpp](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/OMC/OMCProxy.cpp)
- [OMEdit Users Guide](https://openmodelica.org/doc/OpenModelicaUsersGuide/latest/omedit.html) · [Qt Graphics View coords](https://doc.qt.io/qt-6.9/graphicsview.html) · trac [#5631](https://trac.openmodelica.org/OpenModelica/ticket/5631) / [#2850](https://trac.openmodelica.org/OpenModelica/ticket/2850) / [#4551](https://trac.openmodelica.org/OpenModelica/ticket/4551)
