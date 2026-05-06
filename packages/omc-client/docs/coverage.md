# OMC API Coverage Tracker

Tracks which functions in [`src/registry.ts`](../src/registry.ts) are exercised by integration tests against a real OMC, plus the reasons each uncovered function isn't yet tested.

**Pinned OMC version:** `1.26.7` (see [`../src/version.ts`](../src/version.ts)). Drift probe re-run on 2026-05-06 against a freshly-upgraded local 1.26.7; the 5 ⛔ wrappers remain identically broken — these are not 1.26.1-specific quirks but a permanent gap in OMC 1.26.x's interactive scripting surface.
**Last updated:** 2026-05-06.
**Current coverage:** 60 / 80 functions (75%).

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

## Browsing — 10/10 ✅

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

## Reading model contents — 12/12 ✅

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

## Lifecycle — 12/16

| Function | Status | Docs | Notes |
|---|---|---|---|
| `loadFile` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.loadFile.html) | |
| `loadString` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.loadString.html) | Used by every fixture; verified through fixture creation. |
| `loadModel` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.loadModel.html) | |
| `parseFile` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.parseFile.html) | |
| `createClass` | ⛔ | 404 | **Confirmed missing on OMC 1.26.x** — probe verdicts identical on 1.26.1 and 1.26.7 (`Class createClass not found in scope <global scope>`). Wrapper marked `@deprecated` with migration guidance to `loadString`. |
| `createSubClass` | ⛔ | 404 | **Confirmed missing on OMC 1.26.x**. Same migration path as `createClass`. |
| `renameClass` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.renameClass.html) | Output schema fixed to `{ result: string[] }` per OMC docs. |
| `deleteClass` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.deleteClass.html) | OMC 1.26 returns null on success; wrapper handles via `parseMutationSuccess`. |
| `copyClass` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.copyClass.html) | **Wrapper bug fixed**: destination is a `String` per docs (now quoted), not a TypeName. Output renamed `success` → `result` to match docs. |
| `moveClass` | ⛔ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.moveClass.html) | **Confirmed missing on OMC 1.26.x** despite a public docs page — probe ✗ on both 1.26.1 and 1.26.7. Wrapper marked `@deprecated`; migration via `listFile` + own-writer persistence. Note the asymmetry: only the cross-package relocate is missing — the in-place reorderers below work. |
| `moveClassToTop` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.moveClassToTop.html) | Drift probe found this works on 1.26.x despite the related `moveClass` being missing — verified by integration test on a `loadString`-built 3-class package. |
| `moveClassToBottom` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.moveClassToBottom.html) | Same as `moveClassToTop`. |
| `getSourceFile` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getSourceFile.html) | |
| `setSourceFile` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setSourceFile.html) | |
| `diffModelicaFileListings` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.diffModelicaFileListings.html) | |
| `save` | ⛔ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.save.html) | OMEdit-deprecated; we use Option B persistence. Wrapper kept for completeness only. |

## Parameters & modifiers — 5/9

| Function | Status | Docs | Notes |
|---|---|---|---|
| `getParameterValue` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getParameterValue.html) | |
| `getComponentModifierNames` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getComponentModifierNames.html) | |
| `getComponentModifierValue` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getComponentModifierValue.html) | |
| `getComponentModifierValues` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getComponentModifierValues.html) | |
| `setComponentModifierValue` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setComponentModifierValue.html) | |
| `removeComponentModifiers` | ⛔ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.removeComponentModifiers.html) | **Confirmed missing on OMC 1.26.x** despite a public docs page — probe ✗ on both 1.26.1 and 1.26.7. Wrapper marked `@deprecated`; enumerate modifiers with `getComponentModifierNames` and clear each via `setComponentModifierValue({..., expr: ""})`. |
| `getExtendsModifierNames` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getExtendsModifierNames.html) | Needs a fixture with `extends` clause + modifications. |
| `getExtendsModifierValue` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getExtendsModifierValue.html) | Same. |
| `setExtendsModifierValue` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setExtendsModifierValue.html) | Same. |

## Editing — 10/13

| Function | Status | Docs | Notes |
|---|---|---|---|
| `addComponent` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.addComponent.html) | |
| `deleteComponent` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.deleteComponent.html) | |
| `renameComponent` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.renameComponent.html) | |
| `updateComponent` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.updateComponent.html) | |
| `addConnection` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.addConnection.html) | |
| `deleteConnection` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.deleteConnection.html) | |
| `updateConnection` | ⛔ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.updateConnection.html) | **Confirmed missing on OMC 1.26.x** despite a public docs page — probe ✗ on both 1.26.1 and 1.26.7. Wrapper marked `@deprecated`; combine `deleteConnection` + `addConnection` instead. |
| `addTransition` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.addTransition.html) | Needs a state-machine fixture. |
| `deleteTransition` | 🟡 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.deleteTransition.html) | Same. |
| `addClassAnnotation` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.addClassAnnotation.html) | |
| `setComponentProperties` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setComponentProperties.html) | **Wrapper signature realigned** to the docs-correct 6-arg shape: `prefixArray[5]` (final, flow, stream, protected, replaceable), `variability[String[1]]`, `innerOuter[Boolean[2]]`, `direction[String[1]]`. Public input shape is now `{finalPrefix, flow, stream, protectedPrefix, replaceablePrefix, variability, inner, outer, direction}` — **breaking change** from the previous wrapper shape. |
| `setComponentDimensions` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setComponentDimensions.html) | |
| `setComponentComment` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.setComponentComment.html) | |

## Solver / runtime config — 8/8 ✅

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

## Execution — 3/9

| Function | Status | Docs | Notes |
|---|---|---|---|
| `checkModel` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.checkModel.html) | |
| `translateModel` | 🐢 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.translateModel.html) | Compiles to C; 5–30 s per call. Add behind `OMC_INTEGRATION_HEAVY=1`. |
| `buildModel` | 🐢 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.buildModel.html) | Same. |
| `simulate` | 🐢 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.simulate.html) | Same. Output is the OMC `SimulationResult` record, returned as a raw `Value` tree because it varies across OMC versions. |
| `buildModelFMU` | 🐢 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.buildModelFMU.html) | Slow + needs FMI tooling. |
| `translateModelXML` | 🐢 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.translateModelXML.html) | |
| `importFMU` | 🐢 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.importFMU.html) | Needs an .fmu fixture file. |
| `getSimulationOptions` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getSimulationOptions.html) | |
| `isExperiment` | ✅ | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.isExperiment.html) | |

## Results — 0/3

| Function | Status | Docs | Notes |
|---|---|---|---|
| `readSimulationResultSize` | 📦 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.readSimulationResultSize.html) | Needs a `.mat` from `simulate` — wired with the heavy execution tests. |
| `readSimulationResultVars` | 📦 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.readSimulationResultVars.html) | Same. |
| `closeSimulationResultFile` | 📦 | [docs](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.closeSimulationResultFile.html) | Same. |

---

## Summary by category

| Category | Covered | Total | Notes |
|---|---|---|---|
| Browsing | 10 | 10 | All verified |
| Reading model contents | 12 | 12 | All verified |
| Lifecycle | 12 | 16 | 4 ⛔ — `createClass`, `createSubClass`, `moveClass` (cross-package relocate only), and `save` (deprecated). The two in-place reorderers `moveClassToTop`/`moveClassToBottom` work despite `moveClass` being missing — found via the drift probe. |
| Parameters & modifiers | 5 | 9 | 1 ⛔ (`removeComponentModifiers`, confirmed missing), 3 🟡 (extends-with-modifications fixture) |
| Editing | 10 | 13 | 1 ⛔ (`updateConnection`, confirmed missing), 2 🟡 (state-machine fixture for transitions) |
| Solver / runtime config | 8 | 8 | All verified |
| Execution | 3 | 9 | 6 🐢 deferred to a heavy-test gate |
| Results | 0 | 3 | All 📦 — wire with the heavy execution tests |
| **Total** | **60** | **80** | **75%** |

---

## How to extend coverage

1. **Cheap wins (🟡 → ✅):** add small tests for `loadString` (currently used implicitly), `getExtendsModifier*` (need a fixture with `extends Modelica.Blocks.Math.Gain(k=2)` style modifications), `addTransition`/`deleteTransition` (state-machine fixture).

2. **Heavy execution (🐢 → ✅):** add a separate `mutations-heavy.integration.test.ts` gated by `OMC_INTEGRATION_HEAVY=1`. Compile a tiny model (3-line state-space example) through `translateModel` → `buildModel` → `simulate`, then exercise the three `results/*` functions on the produced `.mat`. Roughly 30–60 s of test runtime.

3. **⛔ symbol-not-found cases on OMC 1.26.x** (probed and confirmed on both 1.26.1 and 1.26.7): `createClass`, `createSubClass`, `moveClass`, `updateConnection`, `removeComponentModifiers`. These have `@deprecated` JSDoc on the wrappers with concrete migration paths to functions that DO work (`loadString`, `listFile`+`loadString` for moves, `delete`+`add` for connection updates, per-modifier clearing for `removeComponentModifiers`). The wrappers stay in the package because they may exist on a different OMC line (1.27+? OMSimulator? OMEdit's internal namespace?). The docs site shows public pages for `moveClass`/`updateConnection`/`removeComponentModifiers` with signatures, but OMC's `--interactive=zmq` doesn't surface those symbols — likely an internal-namespace gap, not a deletion.

4. **Resolved drift cases** (do not re-flag):
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
