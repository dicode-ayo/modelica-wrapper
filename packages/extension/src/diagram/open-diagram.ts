import * as vscode from "vscode";
import {
  OmcClient,
  asString,
  diagram,
  produceParameterModel,
  type ClassDef,
  type DiagramLayout,
  type ModelInstance,
  type UnitTable,
  type Value,
} from "@dicode/omc-client";

import { renderIconLayersToSvg } from "@dicode/diagram-svg";

import { isConnectorKey, parseEntityKey } from "./entity-key.js";

import { createReplLog } from "../commands/repl.js";
import {
  ADD_RESULT_TO_VIEW_COMMAND,
  type AddResultToViewArgs,
} from "../commands/results.js";
import { log } from "../logger.js";
import { sourceUriFor } from "../source-provider.js";

import { applyEdits } from "./apply-edits.js";
import { DIAGRAM_VIEW_TYPE } from "./view-type.js";
import {
  connectedPortsOf,
  filterCompatibleCandidates,
  type CandidateElementsClient,
  type PortMapCache,
} from "./change-class-filter.js";
import {
  buildComponentParameterForm,
  classParameterValueToExpr,
  componentParameterEditPlan,
  type ClassParameterRef,
  type ComponentParameterRef,
} from "./parameter-edits.js";
import { clearComponentModifiers } from "./clear-modifiers.js";
import { diffLayouts } from "./diff-layout.js";
import { applyDisplayUnits } from "./display-unit.js";
import { buildUnitTableForModel, sessionUnitCache } from "./unit-table.js";
import { LibrarySource, SearchAbortedError } from "./library-source.js";
import { simulateInputFromFormValues } from "./simulate-form.js";

/**
 * `Modelica: Open Diagram` command handler. Resolves the target class from the
 * command argument or a quick-pick, then opens the class's `modelica-source:`
 * document in the `modelica.diagram` custom editor.
 */
export async function openDiagram(arg: unknown): Promise<void> {
  const className = await resolveClassName(arg);
  if (!className) return;
  await vscode.commands.executeCommand(
    "vscode.openWith",
    sourceUriFor(className),
    DIAGRAM_VIEW_TYPE,
  );
}

/**
 * Live-searchable class picker for the "Change class" command. The loaded
 * libraries hold thousands of classes, so we query `searchAll` as the user
 * types rather than materialising the whole list. Resolves to the chosen
 * fully-qualified class name, or `undefined` if dismissed.
 *
 * Candidates are narrowed to those that keep `componentName`'s existing
 * connections valid. Each keystroke aborts the previous query so its
 * queued OMC lookups drop instead of holding the serialized socket on
 * behalf of a search nobody is waiting for.
 */
export function pickClassToSwap(
  librarySource: LibrarySource,
  componentName: string,
  currentClass: string,
  client: CandidateElementsClient,
  layout: DiagramLayout,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick();
    quickPick.title = `Change class of ${componentName}`;
    quickPick.placeholder = `Search for a class (currently ${currentClass})`;
    quickPick.matchOnDescription = true;
    const requiredPorts = connectedPortsOf(layout, currentClass, componentName);
    const portCache: PortMapCache = new Map();
    // Guards against a slow earlier query overwriting a newer one's results.
    let seq = 0;
    let inFlight: AbortController | undefined;
    const runSearch = async (query: string): Promise<void> => {
      const mine = ++seq;
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      quickPick.busy = true;
      try {
        const results = await librarySource.searchAll(query, controller.signal);
        const compatible = await filterCompatibleCandidates(
          client,
          results,
          requiredPorts,
          portCache,
          controller.signal,
        );
        if (mine !== seq) return;
        quickPick.items = compatible.map((c) => ({
          label: c.qualified,
          description: c.restriction,
        }));
      } catch (err) {
        if (err instanceof SearchAbortedError) return;
        log.error("changeClassSearch", `search for ${query} failed`, err);
      } finally {
        if (mine === seq) quickPick.busy = false;
      }
    };
    quickPick.onDidChangeValue((v) => void runSearch(v));
    quickPick.onDidAccept(() => {
      const picked = quickPick.selectedItems[0]?.label;
      resolve(picked);
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      inFlight?.abort();
      quickPick.dispose();
      resolve(undefined);
    });
    quickPick.show();
    void runSearch(currentClass);
  });
}

/**
 * Derive a Modelica-legal component instance name from a class name.
 * Strategy: lowercase the leaf segment ("Gain" → "gain"), then suffix
 * a counter ("gain1", "gain2", …) to avoid clashing with existing
 * components in the active class. The counter starts at 1 even when
 * no clash exists so two consecutive adds produce `gain1`, `gain2`
 * (vs. `gain`, `gain1` which reads less consistently).
 *
 * Falls back to `component<n>` if the leaf doesn't yield a valid
 * Modelica identifier (digits or symbols at the start, reserved
 * keyword, etc.). We don't try to compete with OMEdit's identifier
 * shrubbery here — the user can rename in the parameter panel.
 */
export function uniqueComponentName(
  layout: DiagramLayout,
  componentClass: string,
): string {
  const leaf = componentClass.slice(componentClass.lastIndexOf(".") + 1);
  const base = /^[A-Za-z_][A-Za-z_0-9]*$/.test(leaf)
    ? leaf.charAt(0).toLowerCase() + leaf.slice(1)
    : "component";
  const taken = new Set(Object.keys(layout.components));
  // Standalone connectors share the same identifier namespace inside
  // the class — collisions there would also break addComponent.
  for (const name of Object.keys(layout.connectors)) taken.add(name);
  for (let i = 1; ; i += 1) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Build the raw `Placement(...)` annotation for a component whose
 * graphic should sit centred at `(x, y)` in diagram coordinates.
 * 10-unit half-extent matches the Modelica default.
 *
 * Encoding rationale: we deliberately use **absolute extent with no
 * `origin`**, matching `diff-layout.ts:placementAnnotation()` (the
 * helper used by `updateComponent` when the user drags). If the two
 * helpers disagreed on encoding, the round-trip would break — e.g.
 * `shiftPlacement()` only mutates `extent` on drag, so a component
 * originally stored as `origin={x,y}, extent={{-10,-10},{10,10}}`
 * would get rewritten as `extent={{0,0},{20,20}}` (origin dropped)
 * the first time it was moved, and re-fetching the layout would
 * teleport it to the bare extent centre. Keeping both helpers on
 * the same shape avoids that drift.
 *
 * The OMC parser also rejects the positional-`transformation(...)`
 * shape once a `visible=true` sibling is present in the same
 * argument list — see
 * `packages/omc-client/test/addComponent-placement.integration.test.ts`
 * for the probe.
 */
export function placementAt(position: { x: number; y: number }): string {
  const { x, y } = position;
  // This 10-unit half-extent is mirrored by `PLACEMENT_HALF_EXTENT` in
  // diagram-ui's placement preview so the dragged node is the size of the
  // result; the two must agree. Kept separate across the CJS/ESM boundary.
  return `Placement(transformation(extent={{${x - 10}, ${y - 10}}, {${x + 10}, ${y + 10}}}))`;
}

/** Structural client for the partial-class drop guard. */
export interface PartialCheckClient {
  isPartial(input: { typeName: string }): Promise<{ b: boolean }>;
}

/** Result of {@link guardAddComponent}: whether the drop may proceed. */
export type AddComponentGuardResult =
  | { kind: "proceed" }
  | { kind: "blocked"; message: string }
  | { kind: "guard-failed"; message: string };

/**
 * OMEdit refuses to drop a `partial` class as a component —
 * `GraphicsView::addComponent` runs `performElementCreationChecks` before
 * instantiating. OMC's own `addComponent` performs no such check and will
 * happily write an abstract class in as a component. A failure of the guard's
 * own OMC call (`isPartial`) is returned as `guard-failed` rather than thrown,
 * so the caller can fail-open and let `addComponent`'s own error path decide,
 * instead of aborting a drop on a transient guard hiccup.
 */
export async function guardAddComponent(
  client: PartialCheckClient,
  componentClass: string,
): Promise<AddComponentGuardResult> {
  try {
    const { b } = await client.isPartial({ typeName: componentClass });
    return b
      ? {
          kind: "blocked",
          message: `${componentClass} is a partial class and cannot be placed as a component.`,
        }
      : { kind: "proceed" };
  } catch (err) {
    return {
      kind: "guard-failed",
      message: `isPartial ${componentClass} failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Run `simulate(typeName, …)` with the form's submitted values and
 * mirror the result into the REPL transcript. Errors bubble up via the
 * REPL log AND a VSCode toast so they're hard to miss.
 *
 * Kept as a free function (not a method on a wrapper) so it's easy to
 * read alongside the other action handlers — one place, one purpose.
 */
export async function runSimulate(
  client: OmcClient,
  className: string,
  values: Record<string, unknown>,
): Promise<void> {
  const input = simulateInputFromFormValues(className, values);
  const start = input.startTime ?? 0;
  const stop = input.stopTime ?? 1;
  // Placeholder label — replaced with `client.lastCall` after the
  // invocation, so the REPL transcript shows the exact OMC command
  // we sent (matches what `simulate(...)` typed in the REPL would
  // produce).
  let label = `simulate ${className}`;
  const refreshLabel = (): void => {
    if (client.lastCall) label = client.lastCall;
  };
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: false,
      title: `Simulating ${className}`,
    },
    async () => {
      const startedAt = Date.now();
      try {
        // Drain stale errors so anything we read after simulate() is
        // strictly attributable to this run.
        await client.getErrorString();
        const { simulationResult } = await client.simulate(input);
        refreshLabel();
        const replLog = createReplLog(label);
        const elapsedMs = Date.now() - startedAt;
        const { errorString } = await client.getErrorString();

        // OMC's simulate() returns success at the API level even when
        // the C compile / link step fails — the failure surfaces as
        // an empty `resultFile`. Detect that and treat it as an error.
        const resultFile = readRecordString(simulationResult, "resultFile");
        const messagesRaw = readRecordString(simulationResult, "messages");
        if (resultFile.length === 0) {
          const detail = stripBlanks([errorString, messagesRaw]).join("\n");
          replLog.error(
            `compile / run failed after ${elapsedMs} ms\n` +
              (detail.length > 0 ? detail : "OMC returned empty resultFile."),
          );
          void vscode.window.showErrorMessage(
            `Modelica: simulate ${className} failed (no result file)`,
          );
          return;
        }

        const summaryLines = [
          `t ∈ [${start}, ${stop}] in ${elapsedMs} ms`,
          `result: ${resultFile}`,
        ];
        if (errorString.length > 0 && /warning/i.test(errorString)) {
          summaryLines.push(`warnings: ${errorString.split("\n")[0]}`);
        }
        replLog.success(summaryLines.join("\n"));

        // Auto-add the result to a focused postprocessing view, if any. The
        // command no-ops when no result view is open, so Simulate is unaffected
        // for users who aren't doing postprocessing.
        void vscode.commands.executeCommand(ADD_RESULT_TO_VIEW_COMMAND, {
          model: className,
          resultFile,
        } satisfies AddResultToViewArgs);
      } catch (err) {
        refreshLabel();
        const msg = (err as Error).message;
        createReplLog(label).error(msg);
        void vscode.window.showErrorMessage(
          `Modelica: simulate ${className} failed: ${msg}`,
        );
      }
    },
  );
}

function stripBlanks(xs: Array<string | undefined>): string[] {
  return xs.filter((s): s is string => typeof s === "string" && s.length > 0);
}

/**
 * Look up a named field on an OMC record `Value` and return its string
 * payload (or `""` if absent / not a string).
 *
 * The omc-client parser represents records as
 * `{kind: "call", name: "SimulationResult", args: [Value, ...]}` where
 * each arg is a `{kind: "kwarg", name, value}` wrapper around the
 * actual field value. We walk that one level deep — no recursion needed
 * for the fields simulate() returns at the top level (resultFile,
 * messages, …).
 */
function readRecordString(record: Value, fieldName: string): string {
  if (record.kind !== "call" || !Array.isArray(record.args)) return "";
  for (const arg of record.args) {
    if (arg.kind === "kwarg" && arg.name === fieldName) {
      return asString(arg.value) ?? "";
    }
  }
  return "";
}

export async function fetchDiagramLayout(
  client: OmcClient,
  className: string,
): Promise<DiagramLayout> {
  const instance = await fetchModelInstance(client, className);
  return layoutFromInstance(client, className, instance);
}

/**
 * Apply the graphical delta between `prevLayout` and `next` to OMC and return
 * the re-fetched layout. Diffs to `LayoutEdit`s, applies them with an OMC-level
 * snapshot so a partial failure rolls the class back, then re-reads the layout
 * from OMC (the render source of truth). Returns `null` when the two layouts
 * are identical (nothing to apply).
 *
 * `refetch` selects which layout the fresh render is read from, so an
 * icon-layer shape edit re-reads the icon layout rather than the diagram one.
 */
export async function applyDiagramEdits(
  client: OmcClient,
  className: string,
  prevLayout: DiagramLayout,
  next: DiagramLayout,
  refetch: (client: OmcClient, className: string) => Promise<DiagramLayout>,
): Promise<{
  layout: DiagramLayout;
  failed: ReadonlyArray<{ error: string }>;
  rolledBack: boolean;
} | null> {
  const edits = diffLayouts(prevLayout, next);
  if (edits.length === 0) return null;
  const result = await applyEdits(client, className, edits, undefined, {
    snapshot: true,
  });
  const layout = await refetch(client, className);
  return { layout, failed: result.failed, rolledBack: result.rolledBack };
}

/**
 * Build the display-ready `DiagramLayout` from an ALREADY-fetched
 * `ModelInstance`. Split out from `fetchDiagramLayout` so callers that need both
 * the layout and the form (the reset re-open) can share one
 * `getModelInstance` round-trip instead of paying for two back-to-back.
 */
export async function layoutFromInstance(
  client: OmcClient,
  className: string,
  instance: ModelInstance,
): Promise<DiagramLayout> {
  // Best-effort pull of OMC's instantiation-reduced parameter values.
  // Used by the producer to gate conditional components / ports and by
  // the renderer for cross-component label `%`-substitution. If OMC
  // can't instantiate (parse errors, partial loads), we still produce a
  // layout — gating just defaults to "visible", matching pre-feature
  // behaviour.
  const resolvedParameters = await fetchResolvedParameters(client, className);
  const layout = diagram.produceDiagramLayout(
    instance,
    "diagram",
    resolvedParameters,
  );
  // Issue #28 (deferred half): render each parameter label in its
  // `displayUnit` instead of the source `unit`. The webview text path is
  // synchronous and has no OmcClient, so we convert HOST-SIDE here — where
  // the client lives — and rewrite `ParameterDef.value` to the display-unit
  // string the substitution map will read. The conversion is routed through
  // the SAME session-cached unit table the parameter form uses, so a `(unit,
  // displayUnit)` pair is resolved once per session and never duplicated
  // between the form and the labels. Best-effort: a convertUnits throw /
  // incompatible verdict leaves the source value untouched and is logged.
  const cache = sessionUnitCache(client, log.warn);
  return applyDisplayUnits(
    layout,
    (s1, s2) => cache.convertUnits(s1, s2),
    log.warn,
  );
}

/**
 * Build the injected `UnitTable` for a class's parameters via the session
 * cache. Produces the model to learn its base units, then resolves each through
 * the cache (memoised, so a re-open issues zero new OMC calls) — fed back into
 * `buildClassParameterForm` to fill the per-field option lists.
 */
export function buildClassUnitTable(
  client: OmcClient,
  instance: ModelInstance,
): Promise<UnitTable> {
  return buildUnitTableForModel(
    client,
    produceParameterModel(instance),
    log.warn,
  );
}

/**
 * Sub-component variant — produces the model from the component's type + its
 * parent-class overrides, then resolves its base units through the same cache.
 * Returns `undefined` for a primitive-typed leaf (no inspectable type).
 */
export function buildComponentUnitTable(
  client: OmcClient,
  component: Parameters<typeof buildComponentParameterForm>[0],
): Promise<UnitTable | undefined> {
  const type = component.type;
  if (!type || typeof type === "string") return Promise.resolve(undefined);
  const model = produceParameterModel(type, {
    component: component.name,
    componentOverrides: component.modifiers,
  });
  return buildUnitTableForModel(client, model, log.warn);
}

/** The `getSimulationOptions` return — derived from the client method so it
 *  stays in sync without widening the omc-client barrel. */
type GetSimulationOptionsOutput = Awaited<
  ReturnType<OmcClient["getSimulationOptions"]>
>;

/**
 * Resolve the simulate panel's `experiment`-annotation seed values
 * (`startTime`, `stopTime`, `tolerance`, `numberOfIntervals`, `interval`) via
 * `getSimulationOptions`. Some classes (e.g. a freshly-created model with no
 * experiment annotation) make the wrapper throw; OMC's documented defaults are
 * the sensible fallback there, matching the old `buildSimulateForm` behaviour.
 */
export async function fetchSimulationOptions(
  client: OmcClient,
  className: string,
): Promise<GetSimulationOptionsOutput> {
  try {
    return await client.getSimulationOptions({ typeName: className });
  } catch {
    return {
      startTime: 0,
      stopTime: 1,
      tolerance: 1e-6,
      numberOfIntervals: 500,
      interval: 0,
    };
  }
}

async function fetchResolvedParameters(
  client: OmcClient,
  className: string,
): Promise<Record<string, string> | undefined> {
  try {
    const { result } = await client.invoke(
      "getInstantiatedParametersAndValues",
      {
        typeName: className,
      },
    );
    return diagram.parseInstantiatedParameters(result);
  } catch {
    // Swallow — this is a pure UI enrichment. The producer falls back
    // to "no gating" when the map is absent.
    return undefined;
  }
}

export async function fetchModelInstance(
  client: OmcClient,
  className: string,
): Promise<ModelInstance> {
  const { instance } = await client.invoke("getModelInstance", {
    typeName: className,
  });
  return instance;
}

/**
 * Annotation names the icon-only fetch keeps. Mirrors OMEdit's
 * `getModelInstanceAnnotation` call site
 * (`OMEdit/OMEditLIB/OMC/OMCProxy.cpp:3426-3441`): everything needed to
 * paint a class's own icon (and its inherited icon maps) without
 * dragging in the full elaborated AST.
 */
const ICON_ANNOTATION_FILTER = [
  "Icon",
  "IconMap",
  "Diagram",
  "DiagramMap",
  "experiment",
] as const;

/**
 * Build an icon-only `DiagramLayout` for `className` — the cheap path for
 * library-tree thumbnails and icon previews, where the diagram's
 * sub-component placements and connections are irrelevant.
 *
 * Uses the filtered `getModelInstanceAnnotation` (Icon/Diagram-only,
 * deep type expansions pruned) instead of the full `getModelInstance`,
 * which on a PID-style class runs into tens of thousands of JSON lines.
 * Falls back to the full `getModelInstance` on failure, exactly like
 * OMEdit — some classes (parse errors, partial loads) only return a
 * usable tree from the unfiltered call.
 *
 * The producer runs in `"icon"` mode either way: `diagramLayers`,
 * `connections`, and diagram-mode labels are all dropped, so the
 * annotation tree's pruned sub-component types cost us nothing here.
 */
export async function fetchIconLayout(
  client: OmcClient,
  className: string,
): Promise<DiagramLayout> {
  let instance: ModelInstance | undefined;
  try {
    const { instance: annotationInstance } = await client.invoke(
      "getModelInstanceAnnotation",
      {
        typeName: className,
        filter: [...ICON_ANNOTATION_FILTER],
      },
    );
    // A class that simply has no Icon is not a failed call. Instantiating it to
    // look again costs seconds on deep hierarchies, and never returns for the
    // builtins, all to rediscover there is nothing to paint. The cheap call can
    // only fail to answer by throwing — an empty reply fails `JSON.parse`, a
    // malformed one fails the schema — so the fallback belongs in the catch.
    instance = annotationInstance;
  } catch (err) {
    log.warn(
      "fetchIconLayout",
      `filtered getModelInstanceAnnotation failed for ${className}; falling back to full getModelInstance: ${(err as Error).message}`,
    );
  }
  if (instance === undefined) {
    instance = await fetchModelInstance(client, className);
  }
  return diagram.produceDiagramLayout(instance, "icon");
}

/**
 * Render a class's icon to a self-contained SVG thumbnail for the library
 * sidebar. Best-effort: returns `undefined` on any failure or when the class
 * has no drawable icon layers, so the sidebar falls back to its
 * restriction-letter badge.
 */
export async function libraryIconSvg(
  client: OmcClient,
  className: string,
): Promise<string | undefined> {
  try {
    const layout = await fetchIconLayout(client, className);
    if (layout.iconLayers.length === 0) return undefined;
    return renderIconLayersToSvg(layout.iconLayers, {
      coordinateSystem: layout.coordinateSystem,
    });
  } catch (err) {
    log.warn(
      "libraryIconSvg",
      `icon render failed for ${className}: ${(err as Error).message}`,
    );
    return undefined;
  }
}

/**
 * Resolve a class's renderable definition — icon, coordinate system, and ports
 * — for the drag-to-place preview. Best-effort: returns `undefined` on any
 * failure, so a class the preview can't resolve just keeps the crosshair.
 *
 * Uses the full `getModelInstance`: the ports come only from it, not the
 * annotation-filtered call. That is bounded here — one user-chosen, placeable
 * class per drag, not a fan-out.
 */
export async function fetchComponentClass(
  client: OmcClient,
  className: string,
): Promise<ClassDef | undefined> {
  try {
    const { instance } = await client.getModelInstance({ typeName: className });
    return diagram.produceComponentClass(instance);
  } catch (err) {
    log.warn(
      "fetchComponentClass",
      `preview resolve failed for ${className}: ${(err as Error).message}`,
    );
    return undefined;
  }
}

/**
 * Apply each dirty form field as a modifier write against OMC. We
 * compare submitted values to the initial snapshot so unchanged fields
 * aren't rewritten — keeps the source file untouched and avoids
 * spurious REPL noise.
 *
 * Write routing mirrors OMEdit's `mInherited` branch
 * (`Element/ElementProperties.cpp:2317-2344`):
 *   - own (host-declared) param  → `setElementModifierValue(className,
 *     name, expr)` — modifier lands on the host class.
 *   - inherited param (`ref.inheritedFrom` set) →
 *     `setExtendsModifierValue(className, inheritedFrom, name, expr)` —
 *     modifier lands on the `extends` clause it semantically belongs to,
 *     not as a spurious host-level modifier.
 *
 * Failures are surfaced per-field via the REPL log + a single warning
 * toast once the batch completes; we keep going on individual failures
 * so a typo in one field doesn't strand the rest.
 */
export async function applyClassParameterEdits(
  client: OmcClient,
  className: string,
  refs: Record<string, ClassParameterRef>,
  initialValues: Record<string, unknown>,
  submitted: Record<string, unknown>,
): Promise<void> {
  const failures: string[] = [];
  for (const [name, ref] of Object.entries(refs)) {
    // Unsupported (record / complex) params are shown read-only on the
    // form — never write them back regardless of what the form returns.
    if (ref.kind === "unsupported") continue;
    const before = initialValues[name];
    const after = submitted[name];
    if (sameValue(before, after)) continue;
    const expr = classParameterValueToExpr(ref, after);
    let label =
      ref.inheritedFrom !== undefined
        ? `setExtendsModifierValue ${className} ${ref.inheritedFrom} ${name}`
        : `setElementModifierValue ${className} ${name}`;
    try {
      // Drain stale errors so any errorString we read on failure is
      // strictly attributable to this edit (mirrors addComponent /
      // simulate).
      await client.getErrorString();
      const { success } =
        ref.inheritedFrom !== undefined
          ? await client.setExtendsModifierValue({
              typeName: className,
              extendsBase: ref.inheritedFrom,
              modifier: name,
              expr,
            })
          : await client.setElementModifierValue({
              typeName: className,
              elementName: name,
              expr,
            });
      if (client.lastCall) label = client.lastCall;
      const replLog = createReplLog(label);
      if (success) {
        replLog.success(expr === "" ? `cleared ${name}` : `${name} := ${expr}`);
      } else {
        const { errorString } = await client.getErrorString();
        const reason = errorString.trim() || "OMC returned success=false.";
        replLog.error(reason);
        failures.push(`${name}: ${reason}`);
      }
    } catch (err) {
      if (client.lastCall) label = client.lastCall;
      const msg = (err as Error).message;
      createReplLog(label).error(msg);
      failures.push(`${name}: ${msg}`);
    }
  }
  if (failures.length > 0) {
    void vscode.window.showWarningMessage(
      `Modelica: ${failures.length} parameter edit(s) failed — ${failures[0]}`,
    );
  }
}

/**
 * Sub-component variant of `applyClassParameterEdits`. Targets
 * `setElementModifierValue(className, "<componentName>.<paramName>",
 * expr)` so the modifier lands on the parent class — not on the type
 * declaration. Same per-field REPL + summary-toast policy.
 */
export async function applyComponentParameterEdits(
  client: OmcClient,
  className: string,
  componentName: string,
  refs: Record<string, ComponentParameterRef>,
  initialValues: Record<string, unknown>,
  submitted: Record<string, unknown>,
): Promise<void> {
  // NOTE: there is deliberately NO `removeElementModifiers` fast-path here
  // (issue #76, item 1). The form only surfaces `variability=="parameter"`
  // elements, but `removeElementModifiers` strips *every* value modifier on
  // the sub-component — `start=`, `fixed=`, `nominal=`, `displayUnit=`, and
  // modifiers on non-parameter members — including bindings the user never
  // saw in the panel. "Blank all params" must touch only the surfaced
  // parameters, which the per-field loop below does by clearing each one
  // with `setElementModifierValue(..., "")`. The bulk `removeElementModifiers`
  // call is reserved for an explicit "reset to defaults" action (whose blast
  // radius the user has knowingly opted into) — see `clearComponentModifiers`.

  const failures: string[] = [];
  const plan = componentParameterEditPlan(
    componentName,
    refs,
    initialValues,
    submitted,
  );
  for (const { elementName, expr } of plan) {
    let label = `setElementModifierValue ${className} ${elementName}`;
    try {
      await client.getErrorString();
      const { success } = await client.setElementModifierValue({
        typeName: className,
        elementName,
        expr,
      });
      if (client.lastCall) label = client.lastCall;
      const replLog = createReplLog(label);
      if (success) {
        replLog.success(
          expr === "" ? `cleared ${elementName}` : `${elementName} := ${expr}`,
        );
      } else {
        const { errorString } = await client.getErrorString();
        const reason = errorString.trim() || "OMC returned success=false.";
        replLog.error(reason);
        failures.push(`${elementName}: ${reason}`);
      }
    } catch (err) {
      if (client.lastCall) label = client.lastCall;
      const msg = (err as Error).message;
      createReplLog(label).error(msg);
      failures.push(`${elementName}: ${msg}`);
    }
  }
  if (failures.length > 0) {
    void vscode.window.showWarningMessage(
      `Modelica: ${failures.length} parameter edit(s) failed — ${failures[0]}`,
    );
  }
}

/**
 * "Reset to defaults" for a sub-component: bulk-clear every modifier on
 * `componentName` with one `removeElementModifiers(..., keepRedeclares=
 * true)` (issue #30). `keepRedeclares=true` strips parameter-value
 * modifiers while preserving any `redeclare` type substitutions — the
 * reset-values-but-keep-the-substituted-type semantics OMEdit uses.
 *
 * Returns OMC's `success` flag so the caller can decide whether to
 * refresh the modal. Mirrors `applyComponentParameterEdits`' fast-path
 * REPL-log + warning-toast policy: drain stale errors first, log the
 * exact `client.lastCall` on completion, and surface a `false`/throw via
 * both the REPL transcript and a single warning toast.
 *
 * Pure of the panel object (takes only the client) so it's unit-testable
 * with a mock `OmcClient`; the handler below wires it to the re-fetch +
 * re-open dance.
 *
 * Exported for the unit test — not part of the command's public surface.
 */
export async function resetComponentParameters(
  client: OmcClient,
  className: string,
  componentName: string,
): Promise<boolean> {
  let label = `removeElementModifiers ${className} ${componentName}`;
  try {
    // Drain stale errors so any errorString we read on failure is
    // strictly attributable to this reset (mirrors the submit path).
    await client.getErrorString();
    const success = await clearComponentModifiers(
      client,
      className,
      componentName,
      { keepRedeclares: true },
    );
    if (client.lastCall) label = client.lastCall;
    const replLog = createReplLog(label);
    if (success) {
      replLog.success(`reset ${componentName} (cleared all modifiers)`);
      return true;
    }
    const { errorString } = await client.getErrorString();
    const reason = errorString.trim() || "OMC returned success=false.";
    replLog.error(reason);
    void vscode.window.showWarningMessage(
      `Modelica: reset ${componentName} failed — ${reason}`,
    );
    return false;
  } catch (err) {
    if (client.lastCall) label = client.lastCall;
    const msg = (err as Error).message;
    createReplLog(label).error(msg);
    void vscode.window.showWarningMessage(
      `Modelica: reset ${componentName} failed — ${msg}`,
    );
    return false;
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a === "number" &&
    typeof b === "number" &&
    Number.isNaN(a) &&
    Number.isNaN(b)
  ) {
    return true;
  }
  return false;
}

async function resolveClassName(arg: unknown): Promise<string | undefined> {
  if (typeof arg === "string" && arg.length > 0) {
    return arg;
  }
  const input = await vscode.window.showInputBox({
    prompt: "Class to render (e.g. Modelica.Blocks.Examples.PID_Controller)",
    placeHolder: "Modelica.Blocks.Examples.PID_Controller",
  });
  return input ?? undefined;
}

/**
 * Maps a UI entity key (`c:R1`, `k:p`, `k:R1.p`) to the omc-client
 * connector reference, validating that the referenced port actually
 * exists in the current layout. Returns the same dotted form OMC
 * expects on `addConnection`.
 */
export function keyToCref(layout: DiagramLayout, key: string): string | null {
  const parsed = parseEntityKey(key);
  if (!parsed || !isConnectorKey(parsed)) return null;
  if (parsed.componentName === null) {
    return layout.connectors[parsed.portName] ? parsed.portName : null;
  }
  const comp = layout.components[parsed.componentName];
  if (!comp) return null;
  const cls = layout.classes[comp.classRef];
  if (!cls || !cls.connectors[parsed.portName]) return null;
  return parsed.nodeId;
}
