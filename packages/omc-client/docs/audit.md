# OMC Client API Audit Runbook

A runbook for verifying that `@modelica-wrapper/omc-client` stays consistent with the upstream OpenModelica scripting API documentation **at the pinned OMC version**.

**Run as:** "audit the omc-client package against the OMC docs using `packages/omc-client/docs/audit.md`."

The agent should produce a written report listing matches, mismatches, and missing functions. **Do not modify code without explicit approval** — the audit is read-only.

---

## 0. Pinned OMC version

This package targets a specific OMC version. The pin lives in source code:

- File: [`packages/omc-client/src/version.ts`](../src/version.ts)
- Constant: `SUPPORTED_OMC.primary` (Renovate-managed; check the file for the current value)
- Audited-on date: `SUPPORTED_OMC.auditedOn`

### 0.1 Calibration check (do this FIRST, every audit)

Before any per-function comparison, verify the three places the OMC version is recorded all agree:

| Source | How to read it |
|---|---|
| **Pin** | Read `SUPPORTED_OMC.primary` from `packages/omc-client/src/version.ts` |
| **Runtime** | Inspect the `FROM` line in `.devcontainer/Dockerfile` and the `matrix.omc` in `.github/workflows/ci.yml` — both should be `openmodelica/openmodelica:vX.Y.Z-minimal` matching the pin. The CI workflow has a guard that emits a `::warning::` on mismatch, but the audit should explicitly check. The `-minimal` image excludes the Modelica Standard Library; the integration job installs it at run time via `installPackage(Modelica, "4.1.0+maint.om", exactMatch=true)` from the OMC libraries index. |
| **Docs site** | WebFetch `https://build.openmodelica.org/Documentation/OpenModelica.Scripting.html` and look for "Generated at … by OpenModelica X.Y.Z" in the page footer. This is the version your per-function fetches will reflect. |

Report all three at the top of the audit output, e.g.:

```
Pin (version.ts):    1.26.7
Runtime (Dockerfile): 1.26.7
Docs (build.openmodelica.org): 1.26.7  ← matches pin
```

**If the docs version diverges from the pin**, the audit's per-function comparisons are noisier — flag any mismatch as **"pinned-version uncertainty"** in the report (separate from bugs). When this happens, the resolution is usually a Renovate PR bumping the pin, then re-running the audit.

Renovate will normally keep these aligned automatically. The CI infrastructure is set up so:

- The `dockerfile` Renovate manager updates `.devcontainer/Dockerfile` and the CI matrix when a new OMC release is published.
- A custom regex manager updates `SUPPORTED_OMC.primary` in `version.ts` from the same OpenModelica GitHub release datasource.
- Both bumps land in **a single grouped PR** labeled `omc-update`.
- The `omc-update-audit` workflow runs the integration suite against the new OMC and posts a checklist comment that points back to this runbook.

### 0.2 Investigating discrepancies

If the agent encounters a 404 or schema discrepancy, it should consider whether the function/field exists at the pinned version specifically:

1. First check if the function appears in the OMC release tag matching the pin: `https://github.com/OpenModelica/OpenModelica/releases/tag/v<primary>`. The release notes mention added/removed scripting functions.
2. If reachable, inspect the relevant file in `OpenModelica/OMCompiler/Compiler/Script/CevalScriptBackend.mo` at that tag for the canonical implementation.
3. Failing both, fall back to the current docs and **flag the discrepancy as "pinned-version uncertainty"** in the report.

The runtime mirror of the pin lives on `OmcClient`:

- `OmcClient.supportedOmcVersion` — the static constant
- `await client.getVersionStatus()` — compares the connected OMC against the pin and returns `"exact" | "minor-compatible" | "untested" | "unparseable"`

When the pin needs to change (we move to a new OMC for testing), update `SUPPORTED_OMC` in `version.ts`, run a full audit, fix any drift, and commit together.

**Before flagging missing tests as bugs**, consult [`coverage.md`](./coverage.md) — it tracks which wrappers are integration-verified at the pinned OMC version, which are knowingly unverified (and why), and which are deferred to heavy / FMU-dependent test runs. Many "uncovered" cases are intentional gaps the audit should categorize, not bug-flag.

**Structured-AST endpoint.** `getModelInstance` is the single-call substitute for the legacy multi-call diagram-read path (`getIcon/Diagram/Components/ComponentAnnotations/NthConnection*` plus the per-base-class inheritance walk and per-subcomponent type lookup). OMC returns the entire elaborated model AST as a JSON tree wrapped in a Modelica string literal; the wrapper unwraps and validates against [`../src/_shared/modelInstance.ts`](../src/_shared/modelInstance.ts). Schema validation is exercised against live OMC each test run via [`../test/modelInstance.integration.test.ts`](../test/modelInstance.integration.test.ts) — fixtures are *not* committed (the PID_Controller capture alone is ~38 k lines of pretty-printed JSON). To inspect a captured payload offline, regenerate it on demand via `pnpm --filter @modelica-wrapper/omc-client capture-modelinstance-fixtures`; outputs land in `../test/fixtures/` (gitignored). The annotation-only sibling `getModelInstanceAnnotation` returns the same root shape with subcomponent type expansions pruned — useful for thumbnails. Both calls are first-class wrappers; the legacy granular calls remain for write-path symmetry (there is no set-AST counterpart).

**For ⛔ wrappers, also consult the drift probe**: [`../test/drift-probe.integration.test.ts`](../test/drift-probe.integration.test.ts) sends each suspect call to OMC directly and reports verdicts (`✓ ok` / `⌀ empty` / `✗ symbol-missing` / `⚠ other-error`). The `omc-update-audit` CI workflow runs it on every Renovate OMC bump PR and pastes the result into the PR comment, so ground-truth on the *new* OMC version is available before the agent audit runs. Manual invocation: `OMC_DRIFT_PROBE=1 pnpm --filter @modelica-wrapper/omc-client vitest run test/drift-probe.integration.test.ts --reporter=verbose`.

---

## 1. Authoritative sources

These are the only sources of truth. Do not infer signatures from existing code; always cross-check against the docs.

| Source | URL / location | What it tells you |
|---|---|---|
| OpenModelica.Scripting reference | <https://build.openmodelica.org/Documentation/OpenModelica.Scripting.html> | Per-function pages with the verbatim Modelica function signatures (input/output parameter names and types) |
| Per-function page pattern | `https://build.openmodelica.org/Documentation/OpenModelica.Scripting.<fn>.html` | Replace `<fn>` with the function name, e.g. `getClassInformation` |
| Modelica Specification §18 | <https://specification.modelica.org/maint/3.6/annotations.html> | Used by Phase A annotation parser; not relevant for OMC API audits |
| OMPython parser | <https://github.com/OpenModelica/OMPython> (`OMTypedParser.py`) | Cross-reference for parser edge cases when responses look weird |

When a per-function URL returns 404, treat the function as **undocumented in the public API** — flag it but do not fail the audit. Some functions (e.g. `getSolverMethods`, `getJacobianMethods` on OMC 1.26) are real but undocumented; check `OMEdit/OMCProxy.h` if you need a reference for those.

---

## 2. Conventions the package must follow

These are the rules. A function is **consistent** if and only if all of these hold.

### 2.1 File layout

- Each OMC function gets its own file: `packages/omc-client/src/api/<category>/<functionName>.ts`. The 10 categories are: `browsing/`, `contents/`, `lifecycle/`, `parameters/`, `editing/`, `elements/`, `library/`, `solver/`, `execution/`, `results/`.
- Each category has an `index.ts` barrel that re-exports its functions.
- Reusable schemas live in `packages/omc-client/src/_shared/`. Today: `inputs.ts` (`TypeNameInput`, `OptionalTypeNameInput`), `value.ts` (`ValueSchema`), `parseOutput.ts`, `format.ts` (`quote`, `quoteList`, `mlBool`), `callContext.ts`.

### 2.2 Per-file structure

Every per-function file exports exactly six things, in this order:

1. `<Fn>InputSchema` — the Zod input schema
2. `<Fn>Input` — `z.input<typeof <Fn>InputSchema>` (NOT `z.infer` — `.default()` fields should remain optional for callers)
3. `<Fn>OutputSchema` — the Zod output schema
4. `<Fn>Output` — `z.infer<typeof <Fn>OutputSchema>`
5. `<Fn>Description` — a `string` constant with a plain-English description of the function (see §2.9)
6. `async function <fn>(ctx: CallContext, input: <Fn>Input): Promise<<Fn>Output>` — the implementation

The file's leading docstring must contain the **verbatim Modelica signature** copied from the OMC docs page, prefixed by a one-or-two-sentence plain-English description (mirroring the `<Fn>Description` constant).

### 2.3 Input naming

- For OMC parameters typed `TypeName`, the property name is **always** `typeName`, regardless of what OMC named the parameter (`cl`, `class_`, `name`, `pack`, `className`, etc.). Reuse `_shared/inputs.ts:TypeNameInput` or `OptionalTypeNameInput`.
- For all other inputs (String, Boolean, Integer, Real, String[]), the property name **matches the OMC parameter name exactly**.
- Optional parameters with OMC defaults use `.optional().default(...)`; the default value must match the OMC docs.
- Every Zod field on every input schema MUST carry a `.describe("…")`. The MCP-generation pipeline reads these descriptions through `zod-to-json-schema` (or equivalent) when building MCP tool definitions; missing descriptions silently produce inferior tool docs. Shared schemas in `_shared/inputs.ts` already carry generic descriptions — per-function files only override when the docs-specific semantics warrant it.

### 2.4 Output naming

- Output property names **must match the OMC `output` parameter names exactly** as they appear in the function signature. No renaming, no shortening.
- Even single-field outputs are wrapped in an object — e.g. `getVersion` returns `{ version: string }`, not `string`.
- For OMC functions whose output is a positional tuple/array (e.g. `getClassInformation`, `getNthConnection`, `getSimulationOptions`), the schema's field names must match the docs' `output ...` declaration order and names.
- For OMC functions that are external `"C"` and don't declare named output fields (notably `getComponents`), the documented intended record is OMEdit's de-facto naming. Reference `OMEdit/OMCProxy.cpp`'s `OMCProxy::getComponents` parser if uncertain — it's the closest thing to a spec.
- Every Zod field on every output schema MUST carry a `.describe("…")`. Same MCP-generation rationale as §2.3.

### 2.5 Validation

- Every wrapper's final `return` must go through `parseOutput(<Fn>OutputSchema, data, "<fn>")`. This catches OMC version drift at runtime.
- Inputs are validated by TypeScript at compile time, not at runtime (no `<Fn>InputSchema.parse(input)` call). Adding runtime input validation later is fine; do not add it during an audit unless explicitly asked.

### 2.6 Command formatting

- Use `_shared/format.ts` helpers: `quote(s)` for string-typed args, `quoteList(items)` for `String[:]` args, `mlBool(b)` for booleans.
- For TypeName args: emit them **bare** (unquoted). e.g. `getClassInformation(${input.typeName})`.
- Use a **single template literal** for the command string, never `'a' + 'b'` concatenation — `+` widens template-literal types to plain `string` and breaks the `OmcCommand` type-check.

### 2.7 OmcClient class delegation

- Every per-function module is delegated to from `OmcClient` in `packages/omc-client/src/client.ts` via a one-line method that calls the api function with `this` as the `CallContext`.
- The class method's input/output types must come from the api module — `import * as <category>` then reference `<category>.<Fn>Input`, `<category>.<Fn>Output`.
- OmcClient method names must match the api function names exactly (e.g. `client.getClassInformation`, not `client.classInfo`).

### 2.8 Shared schema reuse

Two layers of reuse, both gated by the same 3-callers minimum:

1. **Whole-object schemas** in `_shared/inputs.ts` / `_shared/outputs.ts` — when 3+ wrappers share the same complete object shape. Reuse via direct assignment (`<Fn>InputSchema = SharedSchema`) or `.extend(...)` for shape augmentation. Names describe the field set (e.g. `TypeNameAndModifierInput`, `SuccessOutput`, `BooleanBOutput`); output-side names keep OMC's verbatim field name (so `BooleanBOutput` exposes `b: boolean`, not `result: boolean`).
2. **Atomic field schemas** in `_shared/fields.ts` — when 3+ wrappers share the same single-field declaration with the same `.describe(...)` text (e.g. `prettyPrint`, `requireExactVersion`, `connectionAnnotation`). Per-function consumers import via property shorthand and may override the description with `.describe(...)` at the use site when OMC docs give a more specific phrasing. Naming convention: lowercase atomic field names (`prettyPrint`) vs. PascalCase whole-object names (`SuccessOutput`); specialized variants of a common field name carry a contextual suffix (`typeNameOfConnection`, `typeNameOfExtends`).

Per-function files keep their 6-export structure and verbatim Modelica signature docstring regardless of which layer they pull from.

```ts
// Layer 1 — whole-object: direct alias when the shared shape matches exactly:
export const IsModelOutputSchema = BooleanBOutput;

// Layer 1 — whole-object: .extend() when the wrapper adds fields:
export const SetComponentModifierValueInputSchema = TypeNameAndModifierInput.extend({
  expr,
});

// Layer 2 — atomic field: property shorthand inside z.object(...):
import { prettyPrint, typeNameOfConnection } from "../../_shared/fields.js";

export const GetNthConnectionInputSchema = z.object({
  typeName: typeNameOfConnection,
  index: z.number().int().positive().describe("1-based connection index, …"),
});

// Layer 2 — atomic field with a more-specific OMC-docs description:
extendsBase: extendsBase.describe(
  "TypeName of the base class on the `extends` clause to mutate.",
),
```

### 2.10 The "Class X not found in scope" diagnostic trap

OMC's interactive scripting emits the same error message for two very
different failures:

```text
Error: Class <FunctionName> not found in scope <global scope>
(looking for a function or record).
```

This message can mean either:

1. **The function genuinely doesn't exist** at this OMC version (e.g.
   `createClass` on 1.26.x — its docs page is also 404).
2. **One of the call's *arguments* failed ident resolution.** OMC tries to
   resolve an unquoted argument as a TypeName/ident, fails to find it in
   scope, and then mis-attributes the failure to the outer function name.

When you see this error during an audit or a new-wrapper bring-up, do NOT
mark the wrapper ⛔ until you've ruled out (2). The discriminating step is
to re-probe with every plausible argument variant:

- **If the OMC docs declare an arg `String <name>`, quote it.** OMC will
  not coerce a bare ident into a String — it will try to resolve the
  ident as a name in scope and fail. Examples discovered this way on
  OMC 1.26.7 (all were silently broken before):
  - `removeComponentModifiers(cl, String componentName, …)` — componentName must be quoted
  - `addTransition(cl, String from, String to, …)` — from/to must be quoted
  - `deleteTransition(cl, String from, String to, …)` — same
  - `addInitialState(cl, String state, …)` — state must be quoted
  - `deleteInitialState(cl, String state)` — same
  - `updateInitialState(cl, String state, …)` — same

- **Re-check argument order.** OMC mis-attributes order errors the same
  way. Example: `updateConnection` docs put `className` first but our
  wrapper sent `(from, to, className, annotate)` — OMC reported "not
  found in scope" instead of an order error.

- **Re-check argument *type*.** Example: `moveClass`'s second arg is an
  `Integer offset` (in-place reorder), not a `TypeName destination`
  (cross-package relocate). Our wrapper sent a TypeName and got the same
  misleading error.

After fixing the call shape, the wrapper typically jumps from ⛔ to ✅
on the same OMC version with no symbol movement.

The drift probe at [`../test/drift-probe.integration.test.ts`](../test/drift-probe.integration.test.ts)
keeps a "counter-example" entry for each fixed shape so the OMC error
pattern stays documented and a future OMC bump won't re-introduce the
bug silently.

### 2.9 Descriptions (MCP metadata)

Each per-function file exports a `<Fn>Description` string constant, sourced from the OpenModelica scripting documentation. The same string is also stored on the `RegistryEntry.description` field. Together with the `.describe()` annotations on every Zod input/output schema field, these descriptions are the authoritative source for the MCP-generation pipeline that derives a Modelica MCP server from this registry.

**Sourcing policy.** For each function, fetch `https://build.openmodelica.org/Documentation/OpenModelica.Scripting.<fn>.html` and extract the prose paragraph above or below the signature. The description constant should be one or two sentences; the leading docstring above the verbatim signature should reflect the same text (possibly slightly expanded with implementation notes the wrapper carries).

**Fallback hierarchy** when the docs page is sparse:

1. Use the docs prose verbatim (lightly reworded for grammar) when present.
2. If no prose is present, derive a one-sentence description from the function name and signature. Be honest: say "List the available linear solvers." not "Comprehensive linear-algebra subsystem inspection."
3. For per-output fields with no docs, infer from the field name + type. For OMC's verbatim conventions like `b: Boolean` (predicate output), say something like *"True if the predicate matches; field name `b` is OMC verbatim."*.
4. **Never invent specifics that aren't in the docs.** If the meaning of a parameter is unclear, say "OMC parameter `<name>`; see the OMC docs page for details." Better honest-vague than wrong-specific.

**Shared-schema descriptions stay generic.** `_shared/inputs.ts` carries descriptions like `"Fully qualified Modelica TypeName … emitted bare to OMC."`. Per-function files only override this on their own schema when the function-specific semantics actually differ (e.g. `loadModel.typeName` means "library to load", not "class to inspect"; `renameClass.typeName` means "old name to rename"). Otherwise the generic description suffices.

**Output `success` and predicate fields.** Boolean success outputs get the canonical phrase `"True if the OMC operation completed without error."`; predicate outputs whose field name is OMC-verbatim (`b`, `result`) note that fact in their description.

**Pinned-OMC drift.** When a function's docs page returns 404 (some `solver/*` functions, `parseFile`, `createClass`, `createSubClass`), the description is derived from the function name + signature and notes the 404 status. The description constant still gets exported — the MCP-generation pipeline must not treat undocumented functions as un-describable.

---

## 3. The audit procedure

Per category (10 total), per function (~130 total):

### Step A — inventory

List every `.ts` file in `packages/omc-client/src/api/<category>/` (excluding `index.ts`). That's the implemented set.

### Step B — fetch the OMC doc

For each function, `WebFetch https://build.openmodelica.org/Documentation/OpenModelica.Scripting.<fn>.html` with prompt: "Extract the exact Modelica function signature verbatim from the Interface section."

If the URL 404s, mark the function as **undocumented** and skip the input/output checks (but still verify steps C and F).

### Step C — compare

For the function file, verify:

- [ ] Leading docstring contains the verbatim Modelica signature (or notes if undocumented)
- [ ] Each input parameter is represented in `<Fn>InputSchema`:
  - [ ] OMC `TypeName <whatever>` → schema field `typeName`
  - [ ] OMC `<other-type> <name>` → schema field `<name>` (exact match)
  - [ ] Default values match OMC's defaults
  - [ ] Optional args use `.optional().default(...)`
- [ ] Each output parameter is represented in `<Fn>OutputSchema`:
  - [ ] Field name matches OMC's `output` parameter name exactly
  - [ ] Type matches (`String` → `z.string()`, `Boolean` → `z.boolean()`, `Integer` → `z.number().int()`, `Real` → `z.number()`, `String[:]` → `z.array(z.string())`)
- [ ] `<Fn>Input` uses `z.input` (not `z.infer`)
- [ ] `<Fn>Output` uses `z.infer`
- [ ] The function calls `parseOutput(<Fn>OutputSchema, ..., "<fn>")` on the return path
- [ ] The function builds its command string via a single template literal (no `+` concatenation across multiple template literals)

### Step D — OmcClient delegation

Open `packages/omc-client/src/client.ts`. Verify:

- [ ] `import * as <category> from "./api/<category>/index.js"` exists
- [ ] A delegation method `client.<fn>(input)` exists with types `<category>.<Fn>Input` / `<category>.<Fn>Output`
- [ ] Method body is the one-liner `return <category>.<fn>(this, input);`

### Step E — barrel + public surface

- [ ] `packages/omc-client/src/api/<category>/index.ts` re-exports the function file
- [ ] `packages/omc-client/src/index.ts` re-exports `<category>` as a namespace

### Step F — integration coverage

- [ ] If the function is reasonably testable against a loaded `Modelica` package without side effects (browsing, contents, parameter readers, solver getters, isExperiment, getSimulationOptions, checkModel), check whether `packages/omc-client/test/integration.test.ts` exercises it.
- Heavy or destructive operations (`buildModel`, `simulate`, `buildModelFMU`, `importFMU`, all of `editing/*`, `lifecycle/saveOrCreate*`, results/*) are intentionally NOT in integration tests yet. Note their absence as **expected** in the report.

---

## 4. Known intentional divergences (do NOT report as bugs)

These are deliberate decisions. If the audit finds them, mark them as **expected divergence** with the reason below.

| Item | OMC docs | Our package | Why |
|---|---|---|---|
| TypeName input parameter name | `cl`, `class_`, `name`, `pack`, `className` (varies per function) | Always `typeName` | Single uniform input convention; reduces caller cognitive load |
| `getComponents` output field names | Not declared in OMC docs (external "C") | OMEdit-derived: `className`, `name`, `comment`, `protection`, `isFinal`, `isFlow`, `isStream`, `isReplaceable`, `variability`, `innerOuter`, `causality`, `dimensions` | OMC doesn't declare these in the public signature; OMEdit's `OMCProxy::getComponents` is the de-facto spec |
| `simulate` output | OMC `SimulationResult` record (variable across versions) | `{ simulationResult: Value }` raw Value tree | OMC versions disagree on field set; raw Value lets callers extract per their version |
| `setComponentModifierValue` / `setExtendsModifierValue` value arg | OMC takes a `Code` expression | We wrap user `expr` in `$Code(=expr)` | Required by OMC's interactive RPC to bypass string-escaping the expression |
| `save` exposed | OMC says deprecated | Wrapped for completeness | Production paths use `listFile` + own writer (Option B persistence — see project README) |
| `buildModelFMU` `includeResources` | "Deprecated and no effect" per OMC docs | Still passed through | Required positionally in the OMC signature |
| `getSolverMethods` and friends 404 in scripting docs | Undocumented in public scripting API | Wrapped per OMEdit's usage | These are real builtins OMEdit calls; we mirror that — null-tolerance handling means empty responses become `[]` |
| Output is wrapped in object even for single-field returns | OMC outputs are positional / scalar | Always `{ <field>: ... }` | Uniform consumer ergonomics; makes adding sibling fields source-compatible |
| `getModelInstance` / `getModelInstanceAnnotation` / `modifierToJSON` output | OMC returns a JSON-encoded string | Wrapper returns the raw string verbatim (e.g. `{ result: string }`) | The wrapper does not parse the JSON — callers `JSON.parse(result)`. Keeps the wrapper dependency-free and lets callers project just what they need |
| `getElements` output | OMC declares no formal output (external "C") | Wrapper returns the raw `Value` tree as `{ elements: Value }` | Element row layout varies across OMC versions; a typed projection would over-specify. Callers walk the tree |
| `getElementsInfo` / `getElementAnnotations` / `getNthConnector*` / inherited-class map annotations output | OMC declares `Expression result` | Wrapper returns the raw `Value` tree as `{ result: Value }` | Same rationale; expression payloads are deeply nested and best left for caller-side projection |
| `setElementType` second arg | OMC: `VariableName typeName` | Wrapper: `newTypeName` | Avoids collision with the package-wide TypeName-rename rule applied to the first arg (`elementName` → `typeName`) |
| `getElementModifierValue` / `getElementModifierValues` / `setParameterValue` / `getComponentComment` second TypeName arg | OMC: `TypeName modifier` / `TypeName variableName` / `TypeName componentName` | Wrapper preserves the OMC name verbatim (no rename to `typeName`) | The package-wide TypeName-rename rule applies only to the *primary* class TypeName arg; secondary TypeName args (dotted member paths) keep the OMC docs name to avoid collision |
| `setElementModifierValue` / `setElementAnnotation` / `setParameterValue` value arg | OMC takes `ExpressionOrModification` / `Expression` | Wrapper wraps user `expr` in `$Code(=expr)` | Same as `setComponentModifierValue` — required to bypass OMC's interactive RPC string-escaping |

---

## 5. Report format

Produce a single Markdown document with this structure:

```markdown
# OMC Client Audit — <YYYY-MM-DD>

**Pinned OMC version:** `SUPPORTED_OMC.primary` (read from version.ts)
**Docs source consulted:** build.openmodelica.org/Documentation (current build)
**Notes on pinned vs. current:** <if the docs site reflects a different version
than the pin, call that out — drift is expected and not a bug here>

## Summary
- Functions audited: N
- Fully consistent: N
- Inconsistencies found: N
- Undocumented (404 on OMC docs): N
- Missing (in docs but not implemented): N
- Pinned-version uncertainties: N (cases where the current docs say one thing
  but we don't know what the pin's docs said)

## Inconsistencies (per category)

### browsing
| Function | Issue | Severity |
|---|---|---|
| getXxx | Output field is `foo` but docs say `bar` | medium |

### contents
...

## Missing functions
| Function | Category (suggested) |
|---|---|
| getNewThing | execution |

## Notes
- (anything that didn't fit the table format)
```

**Severity guidance:**

- **high** — output field name mismatches that would silently corrupt data; missing required input parameters
- **medium** — output field name mismatches that throw at runtime via `parseOutput` (caught early but blocks callers); incorrect default values
- **low** — wording inconsistencies in docstrings, missing optional parameters with non-blocking defaults

---

## 6. Things explicitly out of scope

- The annotation parser (`packages/omc-client/src/parse.ts`, `parse.test.ts`) — that's a separate codebase audited against Modelica spec §18 if/when needed.
- The transport layer (`transport.ts`, `process.ts`, `commands.ts`) — these don't map to OMC docs functions.
- Performance, bundle size, runtime overhead — not part of this audit.
- The `extension/` package — it's not the OMC client.
- Adding new functions found missing — only flag them; do not implement during the audit.
