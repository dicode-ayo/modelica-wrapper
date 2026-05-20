# OMC API Coverage Tracker

Tracks which functions in [`src/registry.ts`](../src/registry.ts) are exercised by integration tests against a real OMC, plus the reasons each uncovered function isn't yet tested.

**Pinned OMC version:** `1.26.7` (see [`../src/version.ts`](../src/version.ts)). On 2026-05-19 a deep re-probe of the previously-⛔ wrappers revealed that 4 of them (`removeComponentModifiers`, `updateConnection`, `moveClass`, plus the newly-added `getReplaceableChoices`) were wrapper-side bugs — wrong argument shape masked by OMC's misleading "Class X not found in scope" diagnostic. See [audit.md §2.10](./audit.md) for the gotcha. After fixing the call shapes, those wrappers + state-machine mutators are now ✅ on 1.26.7. Only `createClass`, `createSubClass`, and `save` remain genuinely ⛔ (docs 404). Same session: added 4 results wrappers (filter / compare / delta / diff) and a heavy integration test that exercises every results wrapper against a real `.mat` file simulated inside a temp directory.
**Last updated:** 2026-05-20.
**Current coverage:** **180 wrappers in package; 167 ✅ verified end-to-end, 10 🟡 cheap unverified, 3 ⛔ broken on pin (93% verified).** 2026-05-20: omc-coverage epic (#31) added import readers (#43), solver getter siblings (#41), 9 class-shape `is*` predicates (#33), browsing extras (#42), editing siblings (#37), 3 library version-conversion wrappers (#40), verified the two inherited-class map annotation readers (#39), and brought Parameters to 16/16 (#36: +4 derived/extends wrappers, 3 extends-modifier 🟡s verified). The 9 library/package-manager calls are exercised opt-in behind `OMC_INTEGRATION_NETWORK=1`. Counts reconciled at merge time. A 2026-05-20 audit also identified ~40 documented OMC scripting functions in scope that are not yet wrapped — see the [100% coverage epic](https://github.com/dicode-ayo/modelica-wrapper/issues?q=is%3Aissue+label%3Aepic+label%3Aomc-coverage) for the plan to close that gap.

> Run `pnpm --filter @modelica-wrapper/omc-client test` to exercise the integration suite. It auto-skips when `omc` isn't on PATH.

> When updating the registry or the audit, refresh this file. The agent runbook at [`audit.md`](./audit.md) instructs auditors to consult this doc before flagging missing tests as bugs.

> **Drift probe**: every ⛔ row below has a ground-truth probe in [`../test/drift-probe.integration.test.ts`](../test/drift-probe.integration.test.ts). Run it manually whenever you suspect ⛔ status has changed: `OMC_DRIFT_PROBE=1 pnpm --filter @modelica-wrapper/omc-client vitest run test/drift-probe.integration.test.ts --reporter=verbose`. The `omc-update-audit` CI workflow runs it automatically on Renovate-bumped PRs and pastes the verdicts into the PR comment. ✗→✓ transitions in the probe output are the signal to un-deprecate a wrapper and add a real test.

---

## Status legend

| Symbol | Meaning |
|---|---|
| ✅ | Verified against real OMC at the pinned version |
| 🟡 | Wrapper exists; not exercised by integration tests yet (cheap to add) |
| ⛔ | Wrapper exists; **does not work** on the pinned OMC (signature drift, undocumented, or moved). Wrapper kept for compat with other versions. |
| 🐢 | Heavy operation deferred (compile, build, full simulate, FMU pipelines). Worth gating behind `OMC_INTEGRATION_HEAVY=1`. |
| 📦 | Depends on a heavy operation having run (e.g., results-reading needs a `.mat` file) |

Each row links to the OMC scripting docs URL. A `404` link means the function isn't in the public scripting reference; we keep the wrapper in case the function lives in an internal namespace or appears in another OMC version.

---

## Browsing — 42/42 ✅

### Original 10 (all ✅ verified)

| Function | Status | Docs |
|---|---|---|
| `getVersion` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getVersion.html) |
| `getClassNames` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getClassNames.html) |
| `searchClassNames` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.searchClassNames.html) |
| `getClassInformation` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getClassInformation.html) |
| `isPackage` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isPackage.html) |
| `getInheritanceCount` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getInheritanceCount.html) |
| `getInheritedClasses` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getInheritedClasses.html) |
| `getUses` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getUses.html) |
| `existClass` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.existClass.html) |
| `getErrorString` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getErrorString.html) |
| `getMessagesStringInternal` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getMessagesStringInternal.html) — structured `ErrorMessage[]` (file/line/col + kind/level/message), used by the extension's Check Model + auto-check diagnostic flows. |

### New 17 predicates (all ✅)

| Function | Status | Docs |
|---|---|---|
| `existModel` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.existModel.html) |
| `existPackage` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.existPackage.html) |
| `getClassRestriction` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getClassRestriction.html) |
| `getClassComment` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getClassComment.html) |
| `isType` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isType.html) |
| `isClass` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isClass.html) — verified via fixture: `class Foo end Foo;` returns true, sibling `block` returns false |
| `isRecord` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isRecord.html) |
| `isBlock` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isBlock.html) |
| `isFunction` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isFunction.html) |
| `isModel` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isModel.html) |
| `isConnector` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isConnector.html) |
| `isPartial` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isPartial.html) |
| `isReplaceable` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isReplaceable.html) — verified via fixture with a `replaceable Real r = 1.0;` element |
| `isProtectedClass` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isProtectedClass.html) — verified via fixture with a protected nested class (+ public-element counter-example) |
| `isEnumeration` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isEnumeration.html) |
| `getEnumerationLiterals` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getEnumerationLiterals.html) |
| `getReplaceableChoices` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getReplaceableChoices.html) — initially flagged ⛔; the docs-correct shape takes **two** TypeNames (`baseClass`, `parentClass`) + 2 optional bools and returns a 2D matrix. See [audit.md §2.10](./audit.md). |

### Browsing extras (added 2026-05-20, all ✅) — #42

| Function | Status | Docs |
|---|---|---|
| `extendsFrom` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.extendsFrom.html) — verified on a 3-class chain fixture. **Pinned-version note:** on OMC 1.26.7 this predicate is NON-transitive — it matches `baseClassName` against the directly-listed (fully-qualified) `extends` clauses only, so `extendsFrom(C, B)` is true but `extendsFrom(C, A)` is false for a chain `A <- B <- C`. The base class must appear fully-qualified in the `extends` clause. The wrapper docstring documents this; for transitive tests use `getInheritedClasses` / `getAllSubtypeOf`. |
| `getAllSubtypeOf` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getAllSubtypeOf.html) — inverse-of-`extendsFrom` query (this one IS transitive). **Note:** the result *includes the class itself*, and names come back relative to `parentClass` (fully-qualified only when `parentClass` is omitted / `AllLoadedClasses`). Verified against the 3-class chain fixture. |
| `classAnnotationExists` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.classAnnotationExists.html) — verified against a class with an `experiment(...)` annotation (true) and a sibling without it (false). |
| `getNthInheritedClass` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getNthInheritedClass.html) — indexed counterpart to `getInheritedClasses`; verified by asserting index 1 matches `getInheritedClasses(...)[0]`. |
| `isShortDefinition` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isShortDefinition.html) — verified true on a `type T = Real;` short definition and false on a `model`. |

### Class-shape / component predicates — 9 added 2026-05-20 (#33, all ✅)

These mirror the existing `is*` predicates but span **three** argument/output shapes — the issue assumed a uniform single-`typeName` / `{ b }` shape, but the OMC docs disagree (verified against the pin):

- `isConstant` / `isParameter` / `isProtected` — **two** TypeName args (`componentName`, `className`); output is `result` (not `b`). Wrapper exposes the containing class as `typeName` (primary TypeName per audit.md §2.3) and the component as `componentName` (secondary TypeName kept verbatim). OMC's call order is `(componentName, className)`.
- `isPrimitive` — single TypeName (`className`); output `result`.
- `isRedeclare` / `isOperator` / `isOperatorFunction` / `isOperatorRecord` / `isOptimization` — single TypeName; output `b`. Use the shared `BooleanBOutput`; the four `result`-shaped ones use the new `BooleanResultOutput` shared atom.

| Function | Status | Docs |
|---|---|---|
| `isConstant` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isConstant.html) — verified via fixture: `constant Real cc` returns true, sibling `parameter pp` returns false |
| `isParameter` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isParameter.html) — verified via fixture (+ constant counter-example) |
| `isProtected` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isProtected.html) — component-level protection; distinct from `isProtectedClass`. Verified via fixture with a protected element (+ public counter-example) |
| `isRedeclare` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isRedeclare.html) — verified via a derived class that redeclares an inherited `replaceable Real` in its body (+ plain-element counter-example) |
| `isPrimitive` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isPrimitive.html) — verified: `Real` is primitive, a `model` is not |
| `isOperator` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isOperator.html) — verified via an `operator` block inside an operator record (+ enclosing-record counter-example) |
| `isOperatorFunction` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isOperatorFunction.html) — verified via an `operator function` declaration (+ counter-example) |
| `isOperatorRecord` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isOperatorRecord.html) — verified via an `operator record` (+ plain-model counter-example) |
| `isOptimization` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isOptimization.html) — `optimization` is Optimica grammar; the test enables it via `setCommandLineOptions("+g=Optimica")` before loading the fixture (+ plain-model counter-example) |

## Reading model contents — 29/29 ✅

| Function | Status | Docs |
|---|---|---|
| `getComponents` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getComponents.html) |
| `getComponentAnnotations` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getComponentAnnotations.html) |
| `getConnectionCount` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getConnectionCount.html) |
| `getNthConnection` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getNthConnection.html) |
| `getNthConnectionAnnotation` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getNthConnectionAnnotation.html) |
| `getTransitions` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getTransitions.html) |
| `getInitialStates` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getInitialStates.html) |
| `getIconAnnotation` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getIconAnnotation.html) |
| `getDiagramAnnotation` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getDiagramAnnotation.html) |
| `getDocumentationAnnotation` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getDocumentationAnnotation.html) |
| `listFile` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.listFile.html) |
| `instantiateModel` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.instantiateModel.html) |
| `getModelInstance` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getModelInstance.html) — collapses the multi-call diagram-read path into one structured-AST call. Schema is validated live against Sin + PID_Controller in [`../test/modelInstance.integration.test.ts`](../test/modelInstance.integration.test.ts); captures are regenerable via `pnpm capture-modelinstance-fixtures` (gitignored). |
| `getModelInstanceAnnotation` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getModelInstanceAnnotation.html) — annotation-only subset, useful for thumbnails |
| `modifierToJSON` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.modifierToJSON.html) |
| `getConnectionList` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getConnectionList.html) — verified on `PID_Controller` |
| `getNthConnector` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getNthConnector.html) — verified via a fixture block that declares `RealInput u` / `RealOutput y` directly (not via extends) |
| `getNthConnectorIconAnnotation` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getNthConnectorIconAnnotation.html) — same fixture, returns the connector's icon-extent tree |
| `getConnectorCount` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getConnectorCount.html) — same fixture; only counts *directly-declared* connectors (not inherited ones, which is why Modelica.Blocks.Math.* return 0) |
| `getNthInheritedClassIconMapAnnotation` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getNthInheritedClassIconMapAnnotation.html) — verified via a fixture where `Child extends Parent annotation(IconMap(primitivesVisible = true))`. OMC subtlety: IconMap on the parent class returns `{Parent, {}}` (empty); the annotation must live on the *extends clause* in the child to populate the inherited map. |
| `getNthInheritedClassDiagramMapAnnotation` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getNthInheritedClassDiagramMapAnnotation.html) — same fixture + extends-clause requirement as the IconMap reader. |
| `getDefaultComponentName` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getDefaultComponentName.html) — shape verified (returns "" on stdlib classes without the annotation) |
| `getDefaultComponentPrefixes` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getDefaultComponentPrefixes.html) — same |
| `getComponentComment` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getComponentComment.html) |
| `getInstantiatedParametersAndValues` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getInstantiatedParametersAndValues.html) — name/value bindings after instantiation; verified in [`../test/integration.test.ts`](../test/integration.test.ts). |
| `getAnnotationNamedModifiers` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getAnnotationNamedModifiers.html) — verified on `Icon`. |
| `getAnnotationModifierValue` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getAnnotationModifierValue.html) — raw modifier text reader; verified end-to-end. |
| `getImportCount` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getImportCount.html) — verified via a `loadString` fixture with two import-clauses (plain `import Modelica.SIunits;` + renamed `import M = Modelica;`). Issue #43. |
| `getNthImport` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getNthImport.html) — returns the `[path, id, kind]` 3-tuple; verified against the same fixture. Issue #43. |

## Lifecycle — 15/18

| Function | Status | Docs | Notes |
|---|---|---|---|
| `loadFile` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.loadFile.html) | |
| `loadString` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.loadString.html) | Used by every fixture; verified through fixture creation. |
| `loadModel` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.loadModel.html) | |
| `parseFile` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.parseFile.html) | |
| `parseString` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.parseString.html) | Used by extension's live-check pipeline — parses source text without polluting the symbol table. |
| `createClass` | ⛔ | 404 | **Confirmed missing on OMC 1.26.x** — probe verdicts identical on 1.26.1 and 1.26.7 (`Class createClass not found in scope <global scope>`). Wrapper marked `@deprecated` with migration guidance to `loadString`. |
| `createSubClass` | ⛔ | 404 | **Confirmed missing on OMC 1.26.x**. Same migration path as `createClass`. |
| `renameClass` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.renameClass.html) | Output schema fixed to `{ result: string[] }` per OMC docs. |
| `deleteClass` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.deleteClass.html) | OMC 1.26 returns null on success; wrapper handles via `parseMutationSuccess`. |
| `copyClass` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.copyClass.html) | **Wrapper bug fixed**: destination is a `String` per docs (now quoted), not a TypeName. Output renamed `success` → `result` to match docs. |
| `moveClass` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.moveClass.html) | **Wrapper rescued 2026-05-19**: the second arg is an `Integer offset` (in-place reorder within the parent's class list, positive = down / negative = up), NOT a TypeName destination. Earlier wrapper versions sent a TypeName and OMC returned the misleading "Class moveClass not found in scope" diagnostic; see [audit.md §2.10](./audit.md). |
| `moveClassToTop` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.moveClassToTop.html) | Drift probe found this works on 1.26.x despite the related `moveClass` being missing — verified by integration test on a `loadString`-built 3-class package. |
| `moveClassToBottom` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.moveClassToBottom.html) | Same as `moveClassToTop`. |
| `getSourceFile` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getSourceFile.html) | |
| `setSourceFile` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setSourceFile.html) | |
| `diffModelicaFileListings` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.diffModelicaFileListings.html) | |
| `save` | ⛔ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.save.html) | OMEdit-deprecated; we use Option B persistence. Wrapper kept for completeness only. |
| `cd` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.cd.html) | Get/set OMC's working directory. Empty input acts as a getter. Used by the REPL's `:cd` meta-command. |

## Parameters & modifiers — 16/16 ✅

| Function | Status | Docs | Notes |
|---|---|---|---|
| `getParameterValue` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getParameterValue.html) | **Wrapper bugfix 2026-05-19**: `parameterName` is a `String` per docs, not a TypeName — the bare-ident form silently returned "" for every call. See [audit.md §2.10](./audit.md). |
| `getParameterNames` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getParameterNames.html) | |
| `setParameterValue` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setParameterValue.html) | Round-trip verified via `setParameterValue` → `getParameterValue`. |
| `getComponentModifierNames` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getComponentModifierNames.html) | |
| `getComponentModifierValue` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getComponentModifierValue.html) | |
| `getComponentModifierValues` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getComponentModifierValues.html) | |
| `setComponentModifierValue` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setComponentModifierValue.html) | |
| `removeComponentModifiers` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.removeComponentModifiers.html) | **Wrapper rescued 2026-05-19**: `componentName` is a `String` per the OMC docs and must be quoted. Earlier wrapper versions sent it as a bare ident and OMC returned the misleading "Class removeComponentModifiers not found in scope" diagnostic; see [audit.md §2.10](./audit.md). |
| `getExtendsModifierNames` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getExtendsModifierNames.html) | Verified 2026-05-20 via the self-contained `extends Base(k = 2.5)` fixture — returns `{k}` for `Derived`. |
| `getExtendsModifierValue` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getExtendsModifierValue.html) | Verified 2026-05-20 — returns `2.5` for `Derived` / `Base` / `k`. **Wrapper fix**: OMC returns numeric bindings *bare* (not quoted like `getComponentModifierValue`), so `asString` returned `undefined` → `""`; now falls back to the trimmed raw text for scalar bindings. |
| `setExtendsModifierValue` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setExtendsModifierValue.html) | Verified 2026-05-20 — sets `k=3.7` and the `listFile` round-trip shows it. |
| `removeExtendsModifiers` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.removeExtendsModifiers.html) | Added 2026-05-19. Verified end-to-end via the `extends` mutation suite (clears `k=2.5` and confirms the modifier value goes empty). |
| `getDerivedClassModifierNames` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getDerivedClassModifierNames.html) | Added 2026-05-20 (#36). Reads modifier names from a short-class-definition. Verified via `type Resistance = Real(quantity=…, unit=…)` → `{quantity, unit}`. |
| `getDerivedClassModifierValue` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getDerivedClassModifierValue.html) | Added 2026-05-20 (#36). Output field is `modifierValue` (OMC verbatim). Verified — `unit` → `"Ohm"`, `quantity` → `"Resistance"`. Same bare-scalar fallback as `getExtendsModifierValue`. |
| `isExtendsModifierFinal` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isExtendsModifierFinal.html) | Added 2026-05-20 (#36). Output field is `isFinal` (OMC verbatim). Verified — returns `false` for the non-final `k` modifier on the `Derived` fixture. |
| `setExtendsModifier` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setExtendsModifier.html) | Added 2026-05-20 (#36). **Confirmed a distinct 3-arg function, NOT a deprecated alias of `setExtendsModifierValue`** (docs page has no deprecation note; takes a whole `ExpressionOrModification` `(k = 3.7)` rather than a named element + value). Wrapped as `$Code(…)` **without** the leading `=` — `$Code(=(k=3.7))` is a syntax error on the pin. Verified — replaces the whole modification and the `listFile` round-trip shows `k = 9.9`. |

## Editing — 21/21 ✅

| Function | Status | Docs | Notes |
|---|---|---|---|
| `addComponent` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.addComponent.html) | |
| `deleteComponent` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.deleteComponent.html) | |
| `renameComponent` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.renameComponent.html) | |
| `updateComponent` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.updateComponent.html) | |
| `addConnection` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.addConnection.html) | |
| `deleteConnection` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.deleteConnection.html) | |
| `updateConnection` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.updateConnection.html) | **Wrapper rescued 2026-05-19**: docs order is `(TypeName className, String from, String to, annotate)` — earlier wrapper had from/to before className AND sent them unquoted; OMC returned the misleading "Class updateConnection not found in scope" diagnostic; see [audit.md §2.10](./audit.md). `updateConnectionAnnotation` is intentionally NOT wrapped — its `annotate: String` arg is a strict subset of this wrapper's `annotate: ExpressionOrModification` arg, which already accepts raw `Line(...)` text and is what commit `b6a0538` collapsed `connectionWaypoints` onto. |
| `updateConnectionNames` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.updateConnectionNames.html) | Added 2026-05-20 (issue #37). Rename one or both endpoints of an existing connection without touching the annotation. All four endpoint args are `String`s and must be quoted — same gotcha as the other connection/transition mutators; see [audit.md §2.10](./audit.md). Verified via the editing mutation suite. |
| `addTransition` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.addTransition.html) | **Wrapper bugfix 2026-05-19**: `from` / `to` are `String`s and must be quoted (same gotcha as updateConnection). Previously silently broken in the 🟡 state. Verified via state-machine mutation suite. |
| `deleteTransition` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.deleteTransition.html) | Same fix as addTransition; same gotcha. |
| `updateTransition` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.updateTransition.html) | Added 2026-05-20 (issue #37). Replaces an existing transition's guard, flags, priority, and annotation; caller supplies both the old-identifier tuple (to locate the row) and the new values. Same String-quoting gotcha as `addTransition` / `deleteTransition`. Round-trip-verified in the state-machine mutation suite. |
| `addInitialState` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.addInitialState.html) | Added 2026-05-19. `state` is a `String` and must be quoted — same gotcha as the transition mutators. Verified via state-machine mutation suite. |
| `deleteInitialState` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.deleteInitialState.html) | Same gotcha and verification path as addInitialState. |
| `updateInitialState` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.updateInitialState.html) | Same gotcha and verification path as addInitialState. |
| `renameComponentInClass` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.renameComponentInClass.html) | Added 2026-05-19. Single-class variant of `renameComponent` (no cross-class reference rewriting). Despite the docs saying `output String result`, OMC returns a list — wrapper exposes it as `rewrittenDeclarations: string[]` for symmetry with `renameComponent`. |
| `addClassAnnotation` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.addClassAnnotation.html) | |
| `setComponentProperties` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setComponentProperties.html) | **Wrapper signature realigned** to the docs-correct 6-arg shape: `prefixArray[5]` (final, flow, stream, protected, replaceable), `variability[String[1]]`, `innerOuter[Boolean[2]]`, `direction[String[1]]`. Public input shape is now `{finalPrefix, flow, stream, protectedPrefix, replaceablePrefix, variability, inner, outer, direction}` — **breaking change** from the previous wrapper shape. |
| `setComponentDimensions` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setComponentDimensions.html) | |
| `setComponentComment` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setComponentComment.html) | |
| `setClassComment` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setClassComment.html) | Round-trip verified via `setClassComment` → `getClassComment`. |
| `setDocumentationAnnotation` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setDocumentationAnnotation.html) | Round-trip verified via `setDocumentationAnnotation` → `getDocumentationAnnotation`. Output schema is `{ bool: boolean }` (OMC verbatim, not the canonical `success`). |

## Elements (modern Component* generalization) — 10/11

| Function | Status | Docs | Notes |
|---|---|---|---|
| `getElements` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getElements.html) | Smoke-tested against `Modelica.Blocks.Examples.PID_Controller`. |
| `getElementsInfo` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getElementsInfo.html) | Smoke-tested. |
| `getElementAnnotation` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getElementAnnotation.html) | Verified on `PID_Controller`'s `PI` element. |
| `getElementAnnotations` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getElementAnnotations.html) | Verified. |
| `getElementModifierNames` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getElementModifierNames.html) | Verified — returns `k`, `Ti`, `yMax`, etc. for the PI element. |
| `getElementModifierValue` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getElementModifierValue.html) | Verified — `PI.k` returns `100`. |
| `getElementModifierValues` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getElementModifierValues.html) | Verified — returns the leading `= 100` form. |
| `setElementModifierValue` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setElementModifierValue.html) | Verified — sets a sub-modifier like `gain.k = 7.0` on a typed sub-component. NOTE: the `elementName` arg is a sub-modifier path (`gain.k`, `k.start`), not a top-level parameter; for the latter use `setComponentModifierValue` or `setParameterValue`. |
| `setElementAnnotation` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setElementAnnotation.html) | OMC 1.26.7 accepts `$Code(=Dialog(...))` and returns `true`, but the annotation gets *cleared* from the source instead of replaced; none of the alternative `$Code(annotation(...))`/`annotate=...`/bare-Dialog shapes parse successfully via the interactive RPC. Needs OMC-side investigation. |
| `setElementType` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setElementType.html) | Verified — change `Real k` → `Integer k` via the FULL dotted element path `Pkg.Sample.k` (NOT the class name + separate element). |
| `removeElementModifiers` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.removeElementModifiers.html) | Verified — clears `gain.k = 2.5` on a typed sub-component; `componentName` (not `elementName`) is a `String` per docs and must be quoted. |

## Library / package management — 3/12

| Function | Status | Docs | Notes |
|---|---|---|---|
| `getAvailableLibraries` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getAvailableLibraries.html) | Network query. Covered by [`../test/library-network.integration.test.ts`](../test/library-network.integration.test.ts) (gated by `OMC_INTEGRATION_NETWORK=1`; CI keeps it off). |
| `getAvailableLibraryVersions` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getAvailableLibraryVersions.html) | Same gate. |
| `getAvailablePackageVersions` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getAvailablePackageVersions.html) | Same gate. |
| `getAvailablePackageConversionsFrom` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getAvailablePackageConversionsFrom.html) | Added 2026-05-20. Network query — same `OMC_INTEGRATION_NETWORK=1` gate. |
| `getAvailablePackageConversionsTo` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getAvailablePackageConversionsTo.html) | Added 2026-05-20. Same gate. Output field is OMC-verbatim `convertsTo` (matches the `…From` variant). |
| `getConversionsFromVersions` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getConversionsFromVersions.html) | Added 2026-05-20. Two-array partition output `(withoutConversion, withConversion)` — same paren-tuple shape as `diffSimulationResults`. Same gate. |
| `installPackage` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.installPackage.html) | Side-effecting + network. Same gate. |
| `updatePackageIndex` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.updatePackageIndex.html) | Same gate. |
| `upgradeInstalledPackages` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.upgradeInstalledPackages.html) | Same gate. |
| `getLoadedLibraries` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getLoadedLibraries.html) | |
| `getPackages` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getPackages.html) | |
| `loadFiles` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.loadFiles.html) | Verified — writes two temp `.mo` files, loads both in a single call, asserts each class is in OMC's symbol table. |

**Network-gated wrappers.** The 9 🟡 rows above are exercised opt-in by
[`../test/library-network.integration.test.ts`](../test/library-network.integration.test.ts).
Run with:

```sh
OMC_INTEGRATION_NETWORK=1 pnpm --filter @modelica-wrapper/omc-client \
  vitest run test/library-network.integration.test.ts
```

The gate is intentionally off in CI — the OMC package-index endpoint
(`libraries.openmodelica.org`) isn't always reachable from CI runners,
and a flake there would mask wrapper-side regressions. The suite is
kept as 🟡 (not promoted to ✅) because it's never run in the default
verification path; promotion requires either flipping the gate on in CI
or moving to a mocked-index fixture server.

## Solver / runtime config — 13/13 ✅

| Function | Status | Docs |
|---|---|---|
| `getSolverMethods` | ✅ | 404 (undocumented; returns empty on 1.26) |
| `getJacobianMethods` | ✅ | 404 |
| `getInitializationMethods` | ✅ | 404 |
| `getLinearSolvers` | ✅ | 404 |
| `getNonLinearSolvers` | ✅ | 404 |
| `setMatchingAlgorithm` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setMatchingAlgorithm.html) |
| `setIndexReductionMethod` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setIndexReductionMethod.html) |
| `setCommandLineOptions` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setCommandLineOptions.html) |
| `getMatchingAlgorithm` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getMatchingAlgorithm.html) — sibling getter to `setMatchingAlgorithm`; round-trip verified on 1.26.7. |
| `getAvailableMatchingAlgorithms` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getAvailableMatchingAlgorithms.html) — returns aligned `allChoices` / `allComments` arrays; on 1.26.7 includes `PFPlusExt`. |
| `getIndexReductionMethod` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getIndexReductionMethod.html) — sibling getter to `setIndexReductionMethod`; round-trip verified on 1.26.7. |
| `getAvailableIndexReductionMethods` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getAvailableIndexReductionMethods.html) — returns aligned `allChoices` / `allComments` arrays; on 1.26.7 includes `dynamicStateSelection`. |
| `getAvailableTearingMethods` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getAvailableTearingMethods.html) — no setter sibling in this package yet; tearing is typically selected via `setCommandLineOptions("--tearingMethod=...")`. |

## Execution — 9/9 ✅

| Function | Status | Docs | Notes |
|---|---|---|---|
| `checkModel` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.checkModel.html) | |
| `translateModel` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.translateModel.html) | Verified in [`../test/results-heavy.integration.test.ts`](../test/results-heavy.integration.test.ts) on the ramp model. |
| `buildModel` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.buildModel.html) | Verified in [`../test/results-heavy.integration.test.ts`](../test/results-heavy.integration.test.ts) — asserts the returned `[executable, initFile]` shape. |
| `simulate` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.simulate.html) | Verified end-to-end in [`../test/results-heavy.integration.test.ts`](../test/results-heavy.integration.test.ts); also has a shape assertion that the SimulationResult record exposes `resultFile` + `messages`. Output is the OMC `SimulationResult` record as a raw `Value` tree because it varies across OMC versions. |
| `buildModelFMU` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.buildModelFMU.html) | Verified end-to-end in the heavy suite — exports the ramp to a ~1 MB `.fmu`, then feeds it into `importFMU` to round-trip back to Modelica source. |
| `translateModelXML` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.translateModelXML.html) | Verified in [`../test/results-heavy.integration.test.ts`](../test/results-heavy.integration.test.ts); asserts the returned `.xml` filename (on-disk path is OMC-version-dependent). |
| `importFMU` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.importFMU.html) | **Wrapper bugfix 2026-05-19**: `modelName` is a `TypeName` (bare ident), not a String — earlier versions quoted it and OMC returned the misleading "Class importFMU not found in scope" diagnostic (see [audit.md §2.10](./audit.md)). Wrapper now emits `Default` (bare) when omitted. Also realigned: `workdir` default `"<default>"` (was `""`), `loglevel` default `3` (was `0`). Tested by chaining off the `buildModelFMU` output — fully self-contained. |
| `getSimulationOptions` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getSimulationOptions.html) | |
| `isExperiment` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isExperiment.html) | |

## Results — 9/9 ✅

All wrappers in this category are exercised end-to-end by
[`../test/results-heavy.integration.test.ts`](../test/results-heavy.integration.test.ts),
which is gated behind `OMC_INTEGRATION_HEAVY=1` (the suite spins up a
fresh OMC client, runs `simulate` on a tiny ramp model inside a
`mkdtemp` directory, and exercises every results function on the
produced `.mat` file before cleaning up).

| Function | Status | Docs | Notes |
|---|---|---|---|
| `readSimulationResultSize` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.readSimulationResultSize.html) | Verified against the ramp `.mat`. |
| `readSimulationResultVars` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.readSimulationResultVars.html) | Verified with `readParameters=true/false`. |
| `closeSimulationResultFile` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.closeSimulationResultFile.html) | Verified end-to-end. |
| `readSimulationResult` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.readSimulationResult.html) | Verified — endpoints of the ramp match `x(t) = t`. |
| `val` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.val.html) | Verified at t = 0, 0.5, 1 on the ramp. |
| `filterSimulationResults` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.filterSimulationResults.html) | Added 2026-05-19. Writes a smaller `.mat` retaining only requested vars; tested for both straight pass-through and resampling-to-N-intervals. |
| `compareSimulationResults` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.compareSimulationResults.html) | Added 2026-05-19. OMC marks the function itself as deprecated (prefer `diffSimulationResults`); wrapper exposes it for regression-suite consumers. |
| `deltaSimulationResults` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.deltaSimulationResults.html) | Added 2026-05-19. Aggregates error under 1norm/2norm/maxerr. |
| `diffSimulationResults` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.diffSimulationResults.html) | Added 2026-05-19. Returns `(success, failVars[])` tuple — wrapper unpacks both fields. |

**Empty-`String[:]` gotcha.** OMC's interactive RPC does NOT accept the
bare empty literal `{}` for a `String[:]` argument — it triggers the same
"Class X not found in scope" misleading-diagnostic trap documented in
[audit.md §2.10](./audit.md). The accepted empty-literal is `fill("", 0)`.
A shared `quoteListOrFillEmpty()` helper in `_shared/format.ts` emits the
right form; the three comparison wrappers above use it for their optional
`vars` arg.

---

## Summary by category

| Category | Covered | Total | Notes |
|---|---|---|---|
| Browsing | 42 | 42 | All ✅. Custom fixtures cover `isClass`, `isReplaceable`, `isProtectedClass`, the 9 class-shape predicates (#33: `isConstant`, `isParameter`, `isProtected`, `isRedeclare`, `isPrimitive`, `isOperator`, `isOperatorFunction`, `isOperatorRecord`, `isOptimization`), and the #42 extras (`extendsFrom`, `getAllSubtypeOf`, `classAnnotationExists`, `getNthInheritedClass`, `isShortDefinition`). |
| Reading model contents | 29 | 29 | All ✅. 2026-05-20: added `getImportCount` + `getNthImport` (#43); the two inherited-class map annotations (`getNthInheritedClass{Icon,Diagram}MapAnnotation`) verified (#39) — the `IconMap`/`DiagramMap` annotation must live on the `extends` clause in the child, not on the parent class itself (where OMC returns an empty modifier list). |
| Lifecycle | 15 | 18 | 3 ⛔ remain — `createClass`, `createSubClass` (docs 404 + symbol genuinely absent on 1.26.x), `save` (deprecated). **`moveClass` rescued 2026-05-19**: it's an in-place reorder by `Integer offset`, not a TypeName-destination relocate. |
| Parameters & modifiers | 16 | 16 | **All ✅ as of 2026-05-20 (#36).** The 3 extends-modifier 🟡s verified via a self-contained `extends Base(k = 2.5)` fixture; 4 derived-class / extends wrappers added (`getDerivedClassModifierNames`, `getDerivedClassModifierValue`, `isExtendsModifierFinal`, `setExtendsModifier`). `getExtendsModifierValue` needed a bare-scalar fallback (OMC returns numeric bindings unquoted). **`getParameterValue` wrapper bugfix 2026-05-19**: `parameterName` is a `String`, not a TypeName — the bare-ident form silently returned "" since day one. |
| Editing | 21 | 21 | All ✅. **`updateConnection` rescued**: arg order + String-quoting fix. **`addTransition`/`deleteTransition` bugfix**: same String-quoting gotcha — they were silently 🟡 broken before. **Issue #37 (2026-05-20)** added `updateConnectionNames` + `updateTransition`; `updateConnectionAnnotation` is intentionally skipped because `updateConnection`'s `annotate` arg already supersedes it. |
| Elements | 10 | 11 | Only `setElementAnnotation` remains 🟡 — OMC 1.26.7 accepts the call but the annotation always gets cleared rather than replaced, regardless of `$Code` shape (no working payload found). |
| Library | 3 | 12 | The 9 package-manager / version-conversion calls remain 🟡 — all 9 are exercised on demand by [`../test/library-network.integration.test.ts`](../test/library-network.integration.test.ts), gated by `OMC_INTEGRATION_NETWORK=1`. Intentionally off in CI to avoid package-index reachability flakes. |
| Solver / runtime config | 13 | 13 | All verified. Now includes 5 getter siblings (`getMatchingAlgorithm`, `getAvailableMatchingAlgorithms`, `getIndexReductionMethod`, `getAvailableIndexReductionMethods`, `getAvailableTearingMethods`) added in #41. |
| Execution | 9 | 9 | All ✅ via the heavy suite. The FMU pipeline (`buildModelFMU` → `importFMU`) is chained: build the ramp into a `.fmu`, then import it back to a Modelica wrapper. `importFMU` needed a wrapper bugfix on the way — `modelName` is a `TypeName` (bare ident), not a String (see [audit.md §2.10](./audit.md)). |
| Results | 9 | 9 | All ✅ via [`../test/results-heavy.integration.test.ts`](../test/results-heavy.integration.test.ts) — simulates a tiny ramp model in a `mkdtemp` directory, exercises every results wrapper on the produced `.mat`, cleans up. Gated by `OMC_INTEGRATION_HEAVY=1`. |
| **Total verified** | **167** | **180** | **93%** ✅. Of the 13 unverified: 3 ⛔ (`createClass`, `createSubClass`, `save` — genuinely missing/deprecated on the pin), 1 🟡 OMC-side bug (`setElementAnnotation`), 9 🟡 network-only library/package-manager calls (exercised opt-in via `OMC_INTEGRATION_NETWORK=1`). **Audit also identified ~40 documented OMC functions in scope but not yet wrapped — see the 100% coverage epic.** |

---

## How to extend coverage

1. **Cheap wins (🟡 → ✅):** add small tests for `loadString` (currently used implicitly), the two inherited-class map annotations (`getNthInheritedClass{Icon,Diagram}MapAnnotation` — need an inheritance fixture). (The `getExtendsModifier*` family was cleared 2026-05-20 (#36) via the self-contained `extends Base(k = 2.5)` fixture — note OMC returns numeric extends-bindings *unquoted*, so the value reader needs a bare-scalar fallback.)

2. **Heavy execution (🐢 → ✅):** add a separate `mutations-heavy.integration.test.ts` gated by `OMC_INTEGRATION_HEAVY=1`. Compile a tiny model (3-line state-space example) through `translateModel` → `buildModel` → `simulate`, then exercise the five `results/*` functions on the produced `.mat` (including `readSimulationResult` and `val`). Roughly 30–60 s of test runtime.

3. **⛔ symbols genuinely absent on OMC 1.26.x** (docs 404 + drift-probe ✗): `createClass`, `createSubClass`, `save`. Wrappers marked `@deprecated` with concrete migration paths (`loadString` for create; Option B persistence for save). The wrappers stay in the package for forward-compat in case they return in a later OMC.

4. **Wrappers rescued 2026-05-19** (do not re-flag — see [audit.md §2.10](./audit.md) for the "Class X not found in scope" diagnostic trap):
   - `moveClass` — second arg is `Integer offset` (in-place reorder), not a TypeName destination. **Breaking change** to the input shape (`{ typeName, offset }`).
   - `updateConnection` — docs arg order is `(className, from, to, annotate)` with `from`/`to` as Strings. **Breaking change** to the input shape; the input schema now exposes `typeName` first.
   - `removeComponentModifiers` — `componentName` is a `String` and must be quoted (no public API change; wrapper just quotes internally now).
   - `getReplaceableChoices` — two-TypeName signature `(baseClass, parentClass, includePartial?, sort?)` with a 2D matrix output. The first implementation here used the wrong (one-arg) shape. **Breaking change** to the wrapper's input/output schemas.
   - `addTransition` / `deleteTransition` — `from`/`to` are Strings; previously emitted bare and silently broken in the 🟡 state. No public API change.

5. **Resolved drift cases** (do not re-flag):
   - `copyClass` — destination is a `String` per docs; wrapper now quotes it correctly. Output is `result` not `success`.
   - `setComponentProperties` — wrapper realigned to the docs-correct 6-arg shape. **Breaking change** to the public input shape (`{finalPrefix, flow, stream, protectedPrefix, replaceablePrefix, variability, inner, outer, direction}`).
   - `renameClass` — output schema is `{ result: string[] }` per docs (was `{ newQualifiedName: string }` — the original was guesswork).

---

## Counting your own coverage

```sh
# From the repo root, after running tests:
grep -hoE 'client\.[a-zA-Z]+\(' packages/omc-client/test/*.test.ts \
                                packages/omc-client/src/*.test.ts \
  | sed -E 's/client\.([a-zA-Z]+)\(/\1/' | sort -u > /tmp/test-direct.txt
grep -hoE 'invoke\("[a-zA-Z]+"' packages/omc-client/test/*.test.ts \
  | sed -E 's/invoke\("([a-zA-Z]+)"/\1/' | sort -u > /tmp/test-invoke.txt
sort -u /tmp/test-direct.txt /tmp/test-invoke.txt > /tmp/test-calls.txt
grep -oE '^\s+[a-zA-Z]+: entry' packages/omc-client/src/registry.ts \
  | awk '{print $1}' | sed 's/://' | sort -u > /tmp/registry-fns.txt
echo "Tested: $(comm -12 /tmp/registry-fns.txt /tmp/test-calls.txt | wc -l) / $(wc -l < /tmp/registry-fns.txt)"
```
