# Parameter model — design

[← back to README](../README.md) · related: [parameter-panel.md](parameter-panel.md) ·
[architecture.md](architecture.md) · [omc-client.md](omc-client.md)

Status: **implemented.** Shipped in **#78** (the omc-client producers +
`SOLVER_METHODS`) and **#79** (webview renders `ParameterModel` directly; simulate
unified; the JSON-Schema form contract removed), both merged to `main` on
2026-05-21. The deprecated/phantom-wrapper removal it motivated landed in **#80**.

This note describes the as-shipped design: the parameter panel now has the same
shape the diagram already had — a pure producer over `getModelInstance` — and the
diagram value-labels and the parameter form share one model and one cached
unit-conversion pass. The [History](#history--decisions) section at the end records
the decisions made along the way (including ones later reversed).

## Motivation

Before this, the parameter form and the diagram value-labels were built by two
separate host-side code paths that each re-derived the same facts from the same
`ModelInstance` and each issued their own unit calls:

- **Form:** `buildComponentParameterForm` / `buildClassParameterForm` (in the
  extension) → `enrichFormUnitOptions` (`getDerivedUnits` + `convertUnits` per base
  unit).
- **Labels:** `produceDiagramLayout` label substitution → `applyDisplayUnits`
  (`convertUnits` per labeled value).

That duplicated the parameter-extraction logic, duplicated unit conversions over
the *same* parameters, and kept the form builders in the extension where they
couldn't be reused or unit-tested as cleanly as the diagram producer. The wins:
deduplicated logic, fewer **host ↔ OMC** calls (a session unit cache, shared with
labels), a testable producer with a real home in `omc-client`, and — by rendering
the typed model directly — type safety end to end with no JSON-Schema round-trip.

## What can and can't be pure

`produceDiagramLayout` is pure because everything it needs lives in the
`ModelInstance` AST. Parameter **structure** is the same: types, defaults, current
modifiers, `Dialog(group/tab/enable)`, and the base `unit` (a modifier on the
predefined type) are all in the AST, and the `Dialog.enable` evaluator already
lives in `omc-client` ([`src/eval/`](../packages/omc-client/src/eval)).

The two things **not** in the AST, and therefore not derivable purely:

- the **list of alternative units** — `getDerivedUnits(baseUnit)`
- the **affine conversion factors** — `convertUnits(s1, s2)` (OMC's unit database;
  e.g. `degC→K` offset −273.15)

So the producer is pure over `(ModelInstance + an injected unit table)`, exactly as
`produceDiagramLayout` is pure over `(ModelInstance + injected resolvedParameters)`.
The OMC unit calls stay at the host edge and feed the producer.

## The model — `ParameterModel`

A renderer-agnostic model, sibling to `DiagramLayout`, in
`packages/omc-client/src/api/parameters-form/` (as shipped):

```ts
type ParameterFieldKind =
  | "string" | "number" | "integer" | "boolean" | "enum" | "unsupported";

interface UnitOption { unit: string; scaleFactor: number; offset: number }

interface ParameterField {
  name: string;                 // relative name (e.g. "k"); component params target <component>.<name> on submit
  label: string;                // declaration comment, else the name
  kind: ParameterFieldKind;
  value: Expression | string | number | boolean | null;  // instance modifier ?? type default
  defaultValue?: Expression | string | number | boolean;  // type default — for dirty-detection / reset
  enumChoices?: string[];
  enumTypeName?: string;        // qualifies a leaf ("PI") to <typeName>.PI on submit / for Dialog.enable
  dialog: { tab: string; group: string; enable?: Expression };  // tab/group always set (spec §18.7 defaults)
  unit?: string;                // base unit from the AST
  displayUnit?: string;         // displayUnit modifier from the AST, if any
  inheritedFrom?: string;       // direct extends base (write routing for class params)
  unitOptions: ReadonlyArray<UnitOption>;  // filled from an injected UnitTable; empty otherwise
}

interface ParameterModel {
  className: string;
  component?: string;           // crefPrefix for component params; unset for class params
  fields: ParameterField[];
}
```

## Producers (pure)

```ts
produceParameterModel(instance, opts?: {
  component?: string;                       // sub-component instance name → component params
  componentOverrides?: Record<string, Modifier>;  // parent-class per-instance modifiers, folded over type defaults
  resolvedParameters?: Record<string, string>;
  unitTable?: UnitTable;                    // injected; fills unitOptions when present
}): ParameterModel

produceSimulationModel(opts: {
  className: string;
  options: GetSimulationOptionsOutput;      // experiment values (startTime, stopTime, …)
}): ParameterModel
```

- `produceParameterModel` walks the (component's) type extends chain, collects
  `variability == "parameter"` elements, reads `Dialog` annotations, resolves each
  value (instance modifier over type default), and tags `inheritedFrom` (the direct
  extends base) for write routing. It **replaced** the extension's
  `buildComponentParameterForm` / `buildClassParameterForm`.
- `produceSimulationModel` emits the same `ParameterModel` contract (so the simulate
  panel uses the same renderer): time fields carry `unit: "s"`, `numberOfIntervals`
  is an integer, `method`/`outputFormat` are enums, grouped General/Solver/Output.
  Experiment values seed from `options`; the `method` choices come from the
  `SOLVER_METHODS` constant (see [Sources of truth](#sources-of-truth-modelica-spec--omc)).
  Submit is unchanged — `simulateInputFromFormValues` reads the same value keys.
- Both are pure (no OMC contact) and unit-tested, siblings to the diagram producer.

## Unit table + session cache

```ts
type UnitTable = ReadonlyMap<string /*baseUnit*/, ReadonlyArray<UnitOption>>;
```

- A pure `collectBaseUnits(model)` lets the host know which base units to resolve.
- The host builds the `UnitTable` from `getDerivedUnits` + `convertUnits`,
  deduplicated by base unit and **cached for the whole `OmcClient` session**
  (`SessionUnitCache`, a `WeakMap` per client). Units are static, so the cache is
  reused across every panel open *and* every diagram label render — per-class unit
  calls are issued at most once per session.
- `collectDisplayUnitsByBase(model)` folds each field's declared `displayUnit` into
  its base unit's option list even when `getDerivedUnits` omits it (e.g.
  `getDerivedUnits("s")` lacks `"ms"` though `convertUnits("s","ms")` is valid), so
  a declared `displayUnit` is never dropped from the dropdown.
- `applyDisplayUnits` (diagram labels) routes through the same cached `convertUnits`,
  so a `(unit, displayUnit)` pair is resolved once and shared with the form.

## Direct rendering — the form/wire contract

The webview renders the typed `ParameterModel` **directly** for *all* panels
(component params, class params, and simulate). There is **no**
`ParameterModel → JsonSchema` adapter and no `x-modelica-*` round-trip:

- `parametersOpen` carries `model: ParameterModel` (not `schema`/`values`); `kind`
  still routes the submit; `parametersSubmit` carries a flat `values` map plus a
  `dirty` set of the field names the user actually edited — `shapeProperties` is
  the only consumer that reads `dirty` (to tell a deliberately-submitted default
  from an untouched field seeded with one); the other kinds diff `values`
  against their own initial snapshot as before and ignore it.
- diagram-ui maps omc-client's `ParameterField` onto its internal render field via
  `parameterFieldsFromModel` (`parameterFieldsFromSchema` is gone for forms),
  keeping `Dialog.enable` re-evaluation, the unit dropdowns (from `unitOptions`),
  and tab/group layout.
- On submit the form back-converts display units to base units and drops
  `Dialog.enable`-disabled fields — unchanged behaviour.

JSON Schema is no longer a form contract anywhere. (The `JsonSchema` *type* and
`describeFunctionAsJsonSchema` remain — they serve the OMC-function registry/MCP
help, a separate concern.)

## Sources of truth (Modelica spec + OMC)

- **Parameters — fully type-defined.** The `Dialog` annotation is a formal record
  (Modelica spec **§18.7**): `tab, group, enable, showStartAttribute,
  colorSelector, loadSelector, saveSelector, directorySelector, groupImage,
  connectorSizing`. Editable attributes come from the predefined-type attribute
  sets (**§4.8**): `RealType{quantity, unit, displayUnit, min, max, start, fixed,
  nominal, unbounded, stateSelect}`, `IntegerType{…, min, max, start, fixed}`,
  `Boolean/String/Enumeration{quantity, start, fixed}`. All arrive via
  `getModelInstance`. `ParameterField`'s names mirror the `Dialog` record so the
  widgets not rendered yet (the `*Selector` pickers, `colorSelector`,
  `showStartAttribute`, `connectorSizing`) and the numeric attributes
  (`min/max/nominal/start/fixed`) slot in later without a rename.
- **Simulation — only partly standardized.** The Modelica-standard part is the
  `experiment` annotation (**§18.4**): `StartTime, StopTime, Interval, Tolerance` —
  nothing else. There is **no** Modelica-standard "simulation setup" class. The
  full option set is OMC-specific, defined by OMC's `simulate` scripting signature.
  So the simulate panel is sourced from: `simulate`'s signature (structure +
  defaults) + `getSimulationOptions()` (the `experiment` values) + the documented
  **`-s/--solver` value set** for the `method` choices (next section). This is the
  set OMEdit's Simulation Setup dialog assembles.

## `getSolverMethods` is a phantom function — and the #80 removal

Probed live against OMC 1.26.7: `getSolverMethods` (and `getNonLinearSolvers`,
`getLinearSolvers`, `getInitializationMethods`, `getJacobianMethods`) **do not
exist** — `getClassNames(OpenModelica.Scripting)` doesn't list them, and a call
yields `Error: Class getSolverMethods not found in scope`. Those wrappers never
called `getErrorString()`, so the buffered error was swallowed and an empty list
was returned as "success" (the audit.md §2.10 trap; `coverage.md` had mis-marked
them ✅).

Consequences:

- The simulate `method` dropdown is sourced from the exported `SOLVER_METHODS`
  constant — OMC's documented `-s/--solver` set (`dassl` default, `ida`, `cvode`,
  `gbode`, `euler`, `rungekutta`, `symSolver`, `symSolverSsc`, `qss`,
  `optimization`, plus `<default>`). There is no scripting API for this list, so the
  constant **is** the source of truth — not a fallback for a failing call.
- **#80** removed those five phantom wrappers along with the other `@deprecated`
  ones — `createClass`, `createSubClass` (404 + symbol absent; superseded by
  `newModel`) and `compareSimulationResults` (OMC-deprecated; prefer
  `diffSimulationResults`). `save` was kept (⛔ but not `@deprecated`). Each removed
  function's reason is preserved in coverage.md's "Removed wrappers" section
  (`coverage:recount` stays green; wrapper count 207 → 199).

## Acceptance (as shipped)

- All three panels render from `ParameterModel`; the webview no longer parses JSON
  Schema for forms; `parametersOpen` carries `model`. *(This is a deliberate
  protocol change — the internal contract we own.)*
- Component/class param behaviour is unchanged for the user: same fields, unit
  dropdowns, `Dialog.enable` gating, reset-to-defaults, inherited-write routing via
  `setExtendsModifierValue`; submit unit back-conversion preserved.
- Simulate panel behaves identically: same fields/defaults; the `method` dropdown
  shows `SOLVER_METHODS`; the Run path produces the same `simulate(...)` args.
- Diagram value-labels render identically (display units intact); per-class unit
  calls issued at most once per session and shared between form and labels.
- The producers are pure and unit-tested with no OMC dependency; `pnpm -r typecheck`,
  all package suites, and `coverage:recount` pass.

## History / decisions

The decisions made while building this, including the reversed ones — kept so the
"why" survives:

- **Two-PR split.** PR 1 (#78) added the producers to omc-client purely additively;
  PR 2 (#79) migrated the extension + webview. PR 2 was stacked on PR 1.
- **JSON Schema → direct rendering (reversed).** The first plan kept a thin
  `ParameterModel → JsonSchema` adapter and *no* protocol change, encoding Modelica
  facts as `x-modelica-*` keys. That was abandoned before merge: the extension keys
  were the tell that JSON Schema is the wrong abstraction (a typed model re-encoded
  as stringly-typed keys and decoded back), and standard JSON-Schema renderers can't
  read them anyway, so the "portability" was illusory. We render the typed model
  directly instead. Because neither PR had merged, the adapter was never enshrined.
- **`parameterModelToJsonSchema` (added, then removed).** Briefly kept as an
  exported inverse "for non-UI consumers"; deleted as YAGNI when it turned out to
  have no caller. Re-addable from history if a JSON-Schema consumer ever appears.
- **`getDerivedUnitsBatch` (skipped).** A batched unit lookup was considered;
  the per-session cache delivers the dedup win without it.
- **`displayUnit` dropdown fix.** A declared `displayUnit` absent from
  `getDerivedUnits` was initially dropped from the dropdown; fixed via
  `collectDisplayUnitsByBase` (commit `c532a8e`).
- **Phantom `getSolverMethods` investigation → #80 removal.** See the section above.
