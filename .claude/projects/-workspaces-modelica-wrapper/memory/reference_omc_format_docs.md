---
name: OMC RPC format and Modelica annotation grammar — authoritative sources
description: Where to look for ground truth on OMC's response format and Modelica annotation syntax — stop reverse-engineering, read these
type: reference
originSessionId: 02ed9633-dacb-4a1f-863c-f58b7f026daf
---
When validating OMC API wrappers, parsing annotations, or wondering what shape an OMC response should have, consult these in order:

1. **[OpenModelica.Scripting auto-generated API reference](https://build.openmodelica.org/Documentation/OpenModelica.Scripting.html)** — generated directly from OMC's Modelica source. Every scripting call lists its return type as a Modelica signature (e.g. `getClassInformation` is documented as a 22-element tuple of specific types). This is the **authoritative spec** for what `getClassNames`, `getComponents`, `simulate`, etc. return. Always validate `src/omc/client.ts` wrappers against this — never reverse-engineer by trial and error.

2. **[Modelica Spec §18 — Annotations](https://specification.modelica.org/maint/3.6/annotations.html)** — official syntax for graphical annotations (Placement, Transformation, Line, Rectangle, Ellipse, Polygon, Text, Bitmap). §18.6 lists every shape's record fields in the exact order OMC emits them as positional arguments. When implementing the annotation parser (planned at `src/graphics/annotations/parseShape.ts`), transcribe directly from §18.6 — do not guess argument order.

3. **[OMPython](https://github.com/OpenModelica/OMPython)** — official Python client. `OMTypedParser.py` (uses `pyparsing`) is the de-facto reference parser implementation. Cross-reference for edge cases ours may hit: bare-`-` null sentinel, deeply nested calls, brace-vs-paren tuple semantics, escape sequences in strings.

4. **[OMJulia.jl](https://github.com/OpenModelica/OMJulia.jl)** — Julia client. Useful as a second perspective on parser behavior.

5. **[OMEdit source](https://github.com/OpenModelica/OMEdit)** (`OMCProxy.h`, `StringHandler.cpp`) — the C++ Qt reference editor. Read `OMCProxy.h` to understand which calls OMEdit uses for which UI flows. **Do NOT copy `StringHandler::getStrings()` — it is the inherited-bug source the project README explicitly warns against.**

**Working principle:** never reverse-engineer an OMC response by sending probes and inferring shape. For (1) look up the function in the scripting API reference; for (2) open §18.6 and transcribe; for (3) read OMPython's grammar. The 12-test integration probe pass is for verification, not discovery.

No actively-maintained npm/TypeScript OMC client exists, so we won't find a pre-built parser to drop in. The above sources are how we reach parity with the rest of the ecosystem without rebuilding from scratch.

**Pinned OMC version (source of truth for the schema audit):** `packages/omc-client/src/version.ts` — `SUPPORTED_OMC.primary` (Renovate-managed; currently `1.26.7`). The pin is also reflected in `.devcontainer/Dockerfile` and `.github/workflows/ci.yml` via the `openmodelica/openmodelica:vX.Y.Z-minimal` image tag. When auditing, always read the pin first. The audit runbook is at `packages/omc-client/docs/audit.md`; coverage status per-function lives at `packages/omc-client/docs/coverage.md`. Runtime mirror: `OmcClient.supportedOmcVersion` (static) and `await client.getVersionStatus()` (live comparison).

**Drift on OMC 1.26.x (verified on 1.26.1 and 1.26.7):** five wrappers point at scripting symbols that don't exist in OMC's `--interactive=zmq` surface despite some having public docs pages. They're `@deprecated`, with migrations documented in their JSDocs and in `coverage.md`:

- `createClass`, `createSubClass` — undocumented; use `loadString` instead.
- `moveClass` — public docs page exists but symbol not found; use `listFile` + edit + `loadString`.
- `updateConnection` — public docs page exists but symbol not found; use `deleteConnection` + `addConnection`.
- `removeComponentModifiers` — public docs page exists but symbol not found; use `getComponentModifierNames` + `setComponentModifierValue("")` per modifier.

The drift probe at `packages/omc-client/test/drift-probe.integration.test.ts` is the source of truth for these verdicts; it auto-runs on Renovate-bumped PRs via `.github/workflows/omc-update-audit.yml` and posts results to the PR comment.
