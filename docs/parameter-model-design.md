# Parameter model — design

[← back to README](../README.md) · related: [parameter-panel.md](parameter-panel.md) ·
[architecture.md](architecture.md) · [omc-client.md](omc-client.md)

Status: **design, pre-implementation.** This note specifies a refactor that gives
the parameter panel the same shape the diagram already has — a pure producer over
`getModelInstance` — and makes the diagram value-labels and the parameter form
share one model and one unit-conversion pass.

## Motivation

Today the parameter form and the diagram value-labels are built by two separate
host-side code paths that each re-derive the same facts from the same
`ModelInstance` and each issue their own unit calls:

- **Form:** `buildComponentParameterForm` / `buildClassParameterForm` (pure, in the
  extension) → `enrichFormUnitOptions` (`getDerivedUnits` + `convertUnits` per base
  unit). See [parameter-panel.md](parameter-panel.md).
- **Labels:** `produceDiagramLayout` label substitution → `applyDisplayUnits`
  (`convertUnits` per labeled value). See [diagram-rendering.md](diagram-rendering.md).

This duplicates the parameter-extraction logic, duplicates unit conversions over
the *same* parameters, and keeps the form builders in the extension where they
can't be reused or unit-tested as cleanly as the diagram producer.

Note on scope: the **webview ↔ host** traffic is already single-shot (one
`parametersOpen` message carries the whole schema; one `parametersSubmit` returns
it). This refactor does **not** change that contract. The wins are: deduplicated
logic, fewer **host ↔ OMC** calls (cross-session unit cache + shared with labels),
and a testable producer with a real home in `omc-client`.

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

## Design

### 1. `ParameterModel` (new, in `omc-client`)

A renderer-agnostic model, sibling to `DiagramLayout`. Indicative shape (the
implementer may refine field names to match the existing `JsonSchema` /
`ParameterField` vocabulary in [`help.ts`](../packages/omc-client/src/help.ts) and
[`parameter-fields.ts`](../packages/diagram-ui/src/parameter-form/parameter-fields.ts)):

```ts
interface ParameterField {
  name: string;                 // relative parameter name (e.g. "k"); use crefPrefix for component params
  label: string;                // display label (comment, else name)
  kind: "string" | "number" | "integer" | "boolean" | "enum" | "array" | "unsupported";
  value: Expression | string | number | boolean | null;  // instance modifier ?? type default
  defaultValue?: ...;           // type default — for dirty-detection / reset
  enumChoices?: string[];
  dialog?: { group?: string; tab?: string; enable?: Expression };
  unit?: string;                // base unit from the AST
  displayUnit?: string;         // displayUnit modifier from the AST, if any
  inheritedFrom?: string;       // direct extends base (write routing for class params)
  unitOptions?: UnitOption[];   // filled when a unit table is supplied
}

interface UnitOption { unit: string; scaleFactor: number; offset: number }

interface ParameterModel {
  className: string;
  component?: string;           // crefPrefix for component params; unset for class params
  fields: ParameterField[];
}
```

### 2. `produceParameterModel` (pure)

```ts
produceParameterModel(
  instance: ModelInstance,
  opts?: {
    component?: string;                  // sub-component instance name → component params
    resolvedParameters?: Record<string, string>;
    unitTable?: UnitTable;               // injected; fills unitOptions when present
  },
): ParameterModel
```

- Walks the (component's) type extends chain, collects `variability == "parameter"`
  elements, reads `Dialog` annotations, resolves each value (instance modifier over
  type default), tags `inheritedFrom` for class params.
- No OMC contact. Lives next to the diagram producer
  (`packages/omc-client/src/api/diagram/` or a new `parameters-form/` namespace),
  exported from the package barrel.
- This **replaces** `buildComponentParameterForm` / `buildClassParameterForm`,
  which move out of the extension.

### 3. Unit table (host-fetched, injected, cached)

```ts
type UnitTable = ReadonlyMap<string /*baseUnit*/, UnitOption[]>;
```

- A pure `collectBaseUnits(model): string[]` lets the host know which base units to
  resolve.
- The host builds the `UnitTable` from `getDerivedUnits` + `convertUnits`,
  **deduplicated by base unit** (already done within a pass in
  [`unit-options.ts`](../packages/extension/src/diagram/unit-options.ts)) and now
  **cached for the whole `OmcClient` session** — units are static, so the cache is
  reused across every panel open *and* every label render.
- Optional: a `getDerivedUnitsBatch(units[])` wrapper that collapses N base-unit
  lookups into one ZMQ round-trip (single Modelica list expression). Nice-to-have,
  not required for the win.

### 4. Unify form + labels

Both the form schema and the diagram value-labels derive from the shared model +
shared `UnitTable`:

- The form JSON-schema is a thin adapter over `ParameterModel` (host or a small
  `diagram-ui` helper).
- Labels are a *subset* — the parameters referenced by `%`-substitutions / value
  labels — but use the **same** `UnitTable` and the **same** affine conversion
  helper as the form (today's `applyDisplayUnits` and `enrichFormUnitOptions` both
  call `convertUnits` independently; consolidate onto one cached path).

You do **not** render labels directly from the form JSON-schema; both render from
the shared `ParameterModel` / `UnitTable`.

## PR split

Two stacked PRs (PR 2 branches off PR 1):

**PR 1 — `omc-client` foundation (no behavior change to the extension).**
- `ParameterModel` types + `produceParameterModel` pure producer + `collectBaseUnits`.
- `UnitTable` type; optional `getDerivedUnitsBatch` wrapper.
- Pure unit tests (mirror `producer.test.ts` style; fixture-based).
- Barrel exports. `pnpm -r typecheck` + `omc-client` tests + `coverage:recount` green.

**PR 2 — extension migration + label unification + session unit cache.**
- Replace `buildComponentParameterForm` / `buildClassParameterForm` +
  `enrichFormUnitOptions` with `produceParameterModel` + a host-side `UnitTable`
  builder backed by a **session cache** on the client/host.
- Route the diagram label display-unit conversion through the same cached path.
- Keep the `parametersOpen` / `parametersSubmit` wire contract identical.
- Update/extend extension tests (`open-diagram`, `unit-options`,
  `display-unit`, the parameter-form builders' tests migrate to the producer).

## Acceptance criteria

- No change to the `ExtensionToWebview` / `WebviewToExtension` protocol.
- Parameter panel behaviour is unchanged for the user: same fields, units,
  dropdowns, `Dialog.enable` gating, reset, inherited-write routing.
- Diagram value-labels render identically (display units intact).
- The producer is pure and unit-tested with no OMC dependency.
- Unit calls for a given class are issued at most once per session (cache hit on
  re-open), and not duplicated between the form and the labels.
- `pnpm -r typecheck`, all package test suites, and `coverage:recount` pass.

## Risks / open questions

- **Schema dialect coupling.** Keep `ParameterModel` neutral and adapt to the
  webview `JsonSchema` in a thin layer, so the producer isn't tied to one UI.
- **Cache invalidation.** Units are static within an OMC session; the cache can be
  whole-session with no invalidation. Confirm no path mutates unit definitions.
- **`displayUnit` precedence.** Preserve current behaviour: instance-modifier
  `displayUnit` falls back to the source unit (see existing tests).
- **Label subset selection.** Decide whether the producer also emits the label set
  or whether the diagram producer keeps owning label selection and only shares the
  `UnitTable` + conversion helper. Default: share the table + helper, keep label
  selection in the diagram producer to minimise churn.
