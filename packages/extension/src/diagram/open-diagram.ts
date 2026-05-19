import * as vscode from "vscode";
import {
  OmcClient,
  asString,
  diagram,
  type DiagramLayout,
  type ModelInstance,
  type Value,
} from "@modelica-wrapper/omc-client";

import { isConnectorKey, parseEntityKey } from "./entity-key.js";

import { createReplLog } from "../commands/repl.js";
import { log } from "../logger.js";

import { applyEdits } from "./apply-edits.js";
import {
  buildClassParameterForm,
  classParameterValueToExpr,
  type ClassParameterRef,
} from "./class-parameter-form.js";
import {
  buildComponentParameterForm,
  componentParameterElementName,
  componentParameterValueToExpr,
  findSubComponent,
  type ComponentParameterRef,
} from "./component-parameter-form.js";
import { diffLayouts, lineAnnotation, type LayoutEdit } from "./diff-layout.js";
import { LibraryBrowserSource } from "./library-source.js";
import { DiagramPanel } from "./panel.js";
import {
  buildSimulateForm,
  simulateInputFromFormValues,
} from "./simulate-form.js";

/**
 * `Modelica: Open Diagram` command handler. Resolves the target class
 * from either the command argument or a quick-pick prompt, fetches and
 * derives the `DiagramLayout`, opens (or focuses) a `DiagramPanel`,
 * and wires:
 *
 *   onChange           → diff + applyEdits + re-fetch + refresh panel
 *   onConnectionCreate → omc-client.addConnection + re-fetch + refresh
 *
 * F3 keeps the previous-layout reference per session so the next
 * diff is always against the most-recent OMC truth, not the user's
 * in-flight draft.
 */
export async function openDiagram(
  context: vscode.ExtensionContext,
  client: OmcClient,
  arg: unknown,
): Promise<void> {
  const className = await resolveClassName(arg);
  if (!className) {
    return;
  }
  let prevLayout: DiagramLayout;
  try {
    prevLayout = await fetchLayout(client, className);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Modelica: failed to open diagram for ${className}: ${(err as Error).message}`,
    );
    return;
  }

  // One library source per panel — holds a restriction cache keyed
  // by qualified class name so re-expanding the tree doesn't re-hit
  // OMC for restrictions already seen.
  const librarySource = new LibraryBrowserSource(client);

  // Per-modal state for the top-level class-parameter editor. Captured
  // here (vs. on the panel) because the panel only round-trips the
  // form's `{schema, values}`; the submit translator needs the refs and
  // initial values to compute the dirty set.
  let classParamRefs: Record<string, ClassParameterRef> = {};
  let classParamInitialValues: Record<string, unknown> = {};
  // Same idea, for the sub-component parameter editor — plus the
  // owning component name so submit knows where to address writes.
  let componentParamRefs: Record<string, ComponentParameterRef> = {};
  let componentParamInitialValues: Record<string, unknown> = {};
  let componentParamComponentName: string | null = null;

  const panel = DiagramPanel.open(context.extensionUri, className, prevLayout, {
    onChange: async (next) => {
      const edits = diffLayouts(prevLayout, next);
      if (edits.length === 0) {
        return;
      }
      // Mirror every applied edit into the REPL so the user has a
      // running transcript of moves / deletes / connection edits
      // alongside the addComponent + simulate lines they already see.
      // We use the raw `client.lastCall` as the REPL label, matching
      // the addComponent flow.
      const result = await applyEdits(client, className, edits, (edit, command, error) => {
        const log = createReplLog(command);
        if (error !== undefined) {
          log.error(error);
        } else {
          log.success(editSummary(edit));
        }
      });
      if (result.failed.length > 0) {
        const first = result.failed[0]!;
        void vscode.window.showWarningMessage(
          `Modelica: ${result.failed.length} of ${edits.length} edits failed (${first.error}).`,
        );
      }
      try {
        prevLayout = await fetchLayout(client, className);
        panel.update(prevLayout);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Modelica: re-fetch after edits failed: ${(err as Error).message}`,
        );
      }
    },
    onConnectionCreate: async (fromKey, toKey, waypoints) => {
      const from = keyToCref(prevLayout, fromKey);
      const to = keyToCref(prevLayout, toKey);
      if (!from || !to) {
        void vscode.window.showWarningMessage(
          `Modelica: connection endpoints not found (${fromKey}, ${toKey})`,
        );
        return;
      }
      // Match the addComponent / simulate pattern: pre-call placeholder
      // label is replaced with the raw OMC call after the invocation
      // so the REPL transcript shows the exact `addConnection(...)`
      // line — same shape every other mutation prints.
      let label = `addConnection ${from} ↔ ${to}`;
      const refreshLabel = (): void => {
        if (client.lastCall) label = client.lastCall;
      };
      try {
        await client.invoke("addConnection", {
          from,
          to,
          typeName: className,
          annotation: lineAnnotation(waypoints),
        });
        refreshLabel();
        createReplLog(label).success(`connected ${from} ↔ ${to}`);
        prevLayout = await fetchLayout(client, className);
        panel.update(prevLayout);
      } catch (err) {
        refreshLabel();
        const msg = (err as Error).message;
        createReplLog(label).error(msg);
        void vscode.window.showErrorMessage(
          `Modelica: addConnection failed: ${msg}`,
        );
      }
    },
    // ── Action panel ───────────────────────────────────────────────────
    onActionCheck: () => {
      // Re-use the existing user-triggered Check Model command: it
      // resolves the active diagram via `DiagramPanel.activeClassName()`,
      // serializes against live-check, populates diagnostics + REPL.
      void vscode.commands.executeCommand("modelica.checkModel");
    },
    onActionSimulate: async () => {
      try {
        const { schema, values } = await buildSimulateForm(client, className);
        panel.openParameters({
          kind: "simulate",
          schema,
          values,
          title: `Simulate ${className}`,
          submitLabel: "Run",
        });
      } catch (err) {
        log.error("openSimulateForm", `failed for ${className}`, err);
        void vscode.window.showErrorMessage(
          `Modelica: could not open simulate panel for ${className}: ${(err as Error).message}`,
        );
      }
    },
    onEditComponent: async (componentName) => {
      try {
        const instance = await fetchModelInstance(client, className);
        const component = findSubComponent(instance, componentName);
        if (!component) {
          void vscode.window.showInformationMessage(
            `Modelica: component "${componentName}" not found on ${className}.`,
          );
          return;
        }
        const form = buildComponentParameterForm(component);
        if (!form) {
          void vscode.window.showInformationMessage(
            `Modelica: ${componentName} has no editable scalar parameters.`,
          );
          return;
        }
        componentParamRefs = form.refs;
        componentParamInitialValues = form.values;
        componentParamComponentName = form.componentName;
        const typeName =
          typeof component.type === "object" && component.type !== null
            ? component.type.name
            : String(component.type ?? "");
        panel.openParameters({
          kind: "componentParams",
          schema: form.schema,
          values: form.values,
          title: `Parameters: ${componentName}${typeName ? ` (${typeName})` : ""}`,
          submitLabel: "Apply",
          // `Dialog.enable` expressions on this component's parameters
          // are written `<componentName>.<param>` against the parent
          // class scope — strip the prefix so they resolve against the
          // form's local working values.
          crefPrefix: componentName,
        });
      } catch (err) {
        log.error(
          "openComponentParameters",
          `failed for ${className}.${componentName}`,
          err,
        );
        void vscode.window.showErrorMessage(
          `Modelica: could not open parameters for ${componentName}: ${(err as Error).message}`,
        );
      }
    },
    onActionParameters: async () => {
      try {
        const instance = await fetchModelInstance(client, className);
        const form = buildClassParameterForm(instance);
        if (!form) {
          void vscode.window.showInformationMessage(
            `Modelica: ${className} has no editable scalar parameters.`,
          );
          return;
        }
        classParamRefs = form.refs;
        classParamInitialValues = form.values;
        panel.openParameters({
          kind: "classParams",
          schema: form.schema,
          values: form.values,
          title: `Parameters: ${className}`,
          submitLabel: "Apply",
        });
      } catch (err) {
        log.error("openClassParameters", `failed for ${className}`, err);
        void vscode.window.showErrorMessage(
          `Modelica: could not open parameters for ${className}: ${(err as Error).message}`,
        );
      }
    },
    // ── Parameter modal ────────────────────────────────────────────────
    onParametersSubmit: async (kind, values) => {
      if (kind === "simulate") {
        await runSimulate(client, className, values);
        panel.closeParameters();
        return;
      }
      if (kind === "classParams") {
        await applyClassParameterEdits(
          client,
          className,
          classParamRefs,
          classParamInitialValues,
          values,
        );
        try {
          prevLayout = await fetchLayout(client, className);
          panel.update(prevLayout);
        } catch (err) {
          log.error("classParamsRefetch", `failed for ${className}`, err);
        }
        panel.closeParameters();
        return;
      }
      if (kind === "componentParams") {
        if (componentParamComponentName === null) {
          log.warn(
            "componentParamsSubmit",
            "missing componentName — modal opened without state",
          );
          panel.closeParameters();
          return;
        }
        await applyComponentParameterEdits(
          client,
          className,
          componentParamComponentName,
          componentParamRefs,
          componentParamInitialValues,
          values,
        );
        try {
          prevLayout = await fetchLayout(client, className);
          panel.update(prevLayout);
        } catch (err) {
          log.error(
            "componentParamsRefetch",
            `failed for ${className}`,
            err,
          );
        }
        panel.closeParameters();
        return;
      }
      // Unknown kinds: close the modal so the UI doesn't get stuck, and
      // log a warning. We don't surface to the user because the panel was
      // their action — silence is the cheapest "nothing happened".
      log.warn("parametersSubmit", `unhandled kind: ${kind}`);
      panel.closeParameters();
    },
    onParametersCancel: (kind) => {
      log.info("parametersCancel", `kind=${kind}`);
    },
    // ── Library browser ────────────────────────────────────────────────
    onLibraryListChildren: (parent) => librarySource.listChildren(parent),
    onLibrarySearch: (query) => librarySource.searchAll(query),
    onAddComponent: async (componentClass, position) => {
      const componentName = uniqueComponentName(prevLayout, componentClass);
      const annotation = placementAt(position);
      // Pre-call placeholder label; `client.lastCall` after the
      // invocation gives us the exact OMC command we sent, which is
      // what the REPL transcript should show. Mirrors simulate().
      let label = `addComponent ${componentClass}`;
      const refreshLabel = (): void => {
        if (client.lastCall) label = client.lastCall;
      };
      try {
        // Drain stale errors so anything we read from getErrorString()
        // after the call is strictly attributable to this addComponent.
        await client.getErrorString();
        const { success, diagnostic } = await client.addComponent({
          componentName,
          componentClass,
          intoTypeName: className,
          annotation,
        });
        refreshLabel();
        const replLog = createReplLog(label);
        if (!success) {
          // OMC's canonical error pipe; the `diagnostic` field on the
          // wrapper output is a fallback hint when the buffer is empty.
          const { errorString } = await client.getErrorString();
          const reason = pickReason(errorString, diagnostic);
          replLog.error(reason);
          void vscode.window.showErrorMessage(
            `Modelica: addComponent ${componentClass} failed: ${reason}`,
          );
          return;
        }
        // Log the successful instance name + placement so the user
        // can see what landed in the model without having to diff
        // the file.
        replLog.success(`${componentName} : ${componentClass}`);
        prevLayout = await fetchLayout(client, className);
        panel.update(prevLayout);
      } catch (err) {
        refreshLabel();
        const msg = (err as Error).message;
        createReplLog(label).error(msg);
        void vscode.window.showErrorMessage(
          `Modelica: addComponent ${componentClass} failed: ${msg}`,
        );
      }
    },
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
function uniqueComponentName(
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
function placementAt(position: { x: number; y: number }): string {
  const { x, y } = position;
  return `Placement(transformation(extent={{${x - 10}, ${y - 10}}, {${x + 10}, ${y + 10}}}))`;
}

/**
 * Pick the most informative reason string for an addComponent
 * failure: prefer `getErrorString()` (OMC's canonical buffer), fall
 * back to the wrapper-captured trailing diagnostic, then to a
 * placeholder if neither is set. Both inputs may carry trailing
 * whitespace from OMC; trim before testing.
 */
function pickReason(errorString: string, diagnostic: string | undefined): string {
  const e = (errorString ?? "").trim();
  if (e.length > 0) return e;
  const d = (diagnostic ?? "").trim();
  if (d.length > 0) return d;
  return "OMC returned success=false with no diagnostic.";
}

/**
 * Format an applied layout edit as a one-line summary for the REPL
 * transcript. Mirrors what the user actually changed (move, delete,
 * connect) — paired with the raw OMC command as the REPL label.
 */
function editSummary(edit: LayoutEdit): string {
  switch (edit.kind) {
    case "componentPlacement": {
      const [[x1, y1], [x2, y2]] = edit.extent;
      const rot = edit.rotation === 0 ? "" : ` rot=${edit.rotation}°`;
      return `moved ${edit.componentName} → extent={{${x1}, ${y1}}, {${x2}, ${y2}}}${rot}`;
    }
    case "componentDeleted":
      return `deleted ${edit.componentName}`;
    case "connectionAdded":
      return `connected ${edit.from} ↔ ${edit.to}`;
    case "connectionDeleted":
      return `disconnected ${edit.from} ↔ ${edit.to}`;
    case "connectionWaypoints":
      return `re-routed ${edit.from} ↔ ${edit.to} (${edit.waypoints.length} pts)`;
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
async function runSimulate(
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

async function fetchLayout(
  client: OmcClient,
  className: string,
): Promise<DiagramLayout> {
  const instance = await fetchModelInstance(client, className);
  // Best-effort pull of OMC's instantiation-reduced parameter values.
  // Used by the producer to gate conditional components / ports and by
  // the renderer for cross-component label `%`-substitution. If OMC
  // can't instantiate (parse errors, partial loads), we still produce a
  // layout — gating just defaults to "visible", matching pre-feature
  // behaviour.
  const resolvedParameters = await fetchResolvedParameters(client, className);
  return diagram.produceDiagramLayout(instance, "diagram", resolvedParameters);
}

async function fetchResolvedParameters(
  client: OmcClient,
  className: string,
): Promise<Record<string, string> | undefined> {
  try {
    const { result } = await client.invoke("getInstantiatedParametersAndValues", {
      typeName: className,
    });
    return diagram.parseInstantiatedParameters(result);
  } catch {
    // Swallow — this is a pure UI enrichment. The producer falls back
    // to "no gating" when the map is absent.
    return undefined;
  }
}

async function fetchModelInstance(
  client: OmcClient,
  className: string,
): Promise<ModelInstance> {
  const { instance } = await client.invoke("getModelInstance", {
    typeName: className,
  });
  return instance;
}

/**
 * Apply each dirty form field as a `setElementModifierValue(className,
 * paramName, expr)` call against OMC. We compare submitted values to
 * the initial snapshot so unchanged fields aren't rewritten — keeps
 * the source file untouched and avoids spurious REPL noise.
 *
 * Failures are surfaced per-field via the REPL log + a single warning
 * toast once the batch completes; we keep going on individual failures
 * so a typo in one field doesn't strand the rest.
 */
async function applyClassParameterEdits(
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
    let label = `setElementModifierValue ${className} ${name}`;
    try {
      // Drain stale errors so any errorString we read on failure is
      // strictly attributable to this edit (mirrors addComponent /
      // simulate).
      await client.getErrorString();
      const { success } = await client.setElementModifierValue({
        typeName: className,
        elementName: name,
        expr,
      });
      if (client.lastCall) label = client.lastCall;
      const replLog = createReplLog(label);
      if (success) {
        replLog.success(
          expr === "" ? `cleared ${name}` : `${name} := ${expr}`,
        );
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
async function applyComponentParameterEdits(
  client: OmcClient,
  className: string,
  componentName: string,
  refs: Record<string, ComponentParameterRef>,
  initialValues: Record<string, unknown>,
  submitted: Record<string, unknown>,
): Promise<void> {
  const failures: string[] = [];
  for (const [name, ref] of Object.entries(refs)) {
    if (ref.kind === "unsupported") continue;
    const before = initialValues[name];
    const after = submitted[name];
    if (sameValue(before, after)) continue;
    const expr = componentParameterValueToExpr(ref, after);
    const elementName = componentParameterElementName(componentName, name);
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
function keyToCref(layout: DiagramLayout, key: string): string | null {
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
