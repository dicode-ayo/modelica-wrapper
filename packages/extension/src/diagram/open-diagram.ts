import * as vscode from "vscode";
import {
  OmcClient,
  asString,
  diagram,
  produceParameterModel,
  produceSimulationModel,
  type DiagramLayout,
  type ModelInstance,
  type UnitTable,
  type Value,
} from "@modelica-wrapper/omc-client";

import { renderIconLayersToSvg } from "@modelica-wrapper/diagram-svg";

import { isConnectorKey, parseEntityKey } from "./entity-key.js";

import { createReplLog } from "../commands/repl.js";
import {
  ADD_RESULT_TO_VIEW_COMMAND,
  type AddResultToViewArgs,
} from "../commands/results.js";
import { log } from "../logger.js";

import { applyEdits } from "./apply-edits.js";
import {
  buildClassParameterForm,
  buildComponentParameterForm,
  classParameterValueToExpr,
  componentParameterEditPlan,
  findSubComponent,
  type ClassParameterRef,
  type ComponentParameterRef,
} from "./parameter-edits.js";
import { clearComponentModifiers } from "./clear-modifiers.js";
import { diffLayouts, lineAnnotation, type LayoutEdit } from "./diff-layout.js";
import { applyDisplayUnits } from "./display-unit.js";
import { buildUnitTableForModel, sessionUnitCache } from "./unit-table.js";
import { LibraryBrowserSource } from "./library-source.js";
import { captureSnapshot, restoreSnapshot } from "./omc-snapshot.js";
import { DiagramPanel } from "./panel.js";
import { SnapshotStack } from "./snapshot-stack.js";
import { simulateInputFromFormValues } from "./simulate-form.js";

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
  // `model`; the submit translator needs the refs and
  // initial values to compute the dirty set.
  let classParamRefs: Record<string, ClassParameterRef> = {};
  let classParamInitialValues: Record<string, unknown> = {};
  // Same idea, for the sub-component parameter editor — plus the
  // owning component name so submit knows where to address writes.
  let componentParamRefs: Record<string, ComponentParameterRef> = {};
  let componentParamInitialValues: Record<string, unknown> = {};
  let componentParamComponentName: string | null = null;
  // Guards against a double-click on "Reset to defaults" firing two
  // concurrent reset round-trips (each one re-fetches + re-opens the
  // modal). A second invocation while one is in flight returns early.
  let resetInFlight = false;

  // Drops the sub-component submit-translator closure state so a later
  // stray submit can't diff against refs from a now-closed modal. Matches
  // the initial declarations above and the submit-side
  // `if (componentParamComponentName === null)` guard.
  const clearComponentParamState = (): void => {
    componentParamRefs = {};
    componentParamInitialValues = {};
    componentParamComponentName = null;
  };

  // ── Diagram-local undo (issue #29, deferred half) ─────────────────────
  //
  // Diagram edits go straight to OMC (applyEdits / addConnection / param
  // writes) — they never touch a VSCode TextDocument, so native Ctrl-Z can't
  // see them. We keep a per-panel snapshot stack instead: BEFORE each
  // mutating op we push a `captureSnapshot(client, className)` of the host
  // class's source; the Undo action pops the top and replays it via
  // `restoreSnapshot`. Capture is best-effort — a missing snapshot (built-in
  // class, empty listFile) is skipped, so worst case Undo just has nothing
  // to pop. Depth is capped (see SnapshotStack) to bound memory.
  const undoStack = new SnapshotStack();
  // Pull a snapshot of the current class source onto the undo stack. Called
  // immediately before any mutation. Best-effort: a capture failure leaves
  // the stack unchanged rather than aborting the user's edit.
  const pushUndoSnapshot = async (): Promise<void> => {
    try {
      undoStack.push(await captureSnapshot(client, className));
    } catch (err) {
      log.warn(
        "diagramUndoSnapshot",
        `capture failed for ${className}: ${(err as Error).message}`,
      );
    }
  };

  const panel = DiagramPanel.open(context.extensionUri, className, prevLayout, {
    onChange: async (next) => {
      const edits = diffLayouts(prevLayout, next);
      if (edits.length === 0) {
        return;
      }
      // Snapshot the pre-edit class source so the diagram-local Undo can roll
      // this whole batch back (issue #29). Best-effort — see pushUndoSnapshot.
      await pushUndoSnapshot();
      // Mirror every applied edit into the REPL so the user has a
      // running transcript of moves / deletes / connection edits
      // alongside the addComponent + simulate lines they already see.
      // We use the raw `client.lastCall` as the REPL label, matching
      // the addComponent flow.
      const result = await applyEdits(
        client,
        className,
        edits,
        (edit, command, error) => {
          const log = createReplLog(command);
          if (error !== undefined) {
            log.error(error);
          } else {
            log.success(editSummary(edit));
          }
        },
        // Auto-roll-back the whole batch on a partial failure (issue #76,
        // item 14): the rollback-on-partial-failure path is the same
        // snapshot/restore mechanism the diagram-local Undo uses, so the
        // two flows no longer diverge. A partial failure leaves the class
        // in its pre-batch state instead of a half-applied mess.
        { snapshot: true },
      );
      if (result.failed.length > 0) {
        const first = result.failed[0]!;
        const rolled = result.rolledBack
          ? " — rolled back to the pre-edit state"
          : "";
        void vscode.window.showWarningMessage(
          `Modelica: ${result.failed.length} of ${edits.length} edits failed (${first.error})${rolled}.`,
        );
        // The batch was auto-rolled-back, so the pre-batch snapshot we just
        // pushed for manual Undo would be a no-op (it equals current state).
        // Drop it to keep the undo stack meaningful.
        if (result.rolledBack) undoStack.pop();
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
      // Snapshot before the addConnection write so Undo can revert it (#29).
      await pushUndoSnapshot();
      try {
        const conn = await client.invoke("addConnection", {
          from,
          to,
          typeName: className,
          annotation: lineAnnotation(waypoints),
        });
        // `invoke` resolves even when OMC rejected the connect — inspect
        // `success` so a dangling/invalid endpoint surfaces as an error
        // toast instead of a silent "connected" log (issue #76).
        if (!conn.success) {
          throw new Error(
            conn.diagnostic ?? "OMC rejected the connection",
          );
        }
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
    onActionUndo: async () => {
      // Diagram-local undo (issue #29): pop the most-recent pre-edit source
      // snapshot and replay it via loadString. The empty-stack case is a
      // REPL line + a toast — there's nothing to undo, which is normal at the
      // start of a session or after an undo drained the stack.
      const snapshot = undoStack.pop();
      if (!snapshot) {
        createReplLog(`diagram undo ${className}`).error(
          "nothing to undo (snapshot stack empty)",
        );
        void vscode.window.showInformationMessage(
          `Modelica: nothing to undo for ${className}.`,
        );
        return;
      }
      const label = `loadString <undo ${className}>`;
      try {
        const ok = await restoreSnapshot(client, snapshot);
        const replLog = createReplLog(label);
        if (!ok) {
          // OMC rejected the replay — surface it and re-push so a retry (or a
          // later undo) still has the snapshot to work from.
          undoStack.push(snapshot);
          const { errorString } = await client.getErrorString();
          const reason = errorString.trim() || "OMC returned success=false.";
          replLog.error(reason);
          void vscode.window.showErrorMessage(
            `Modelica: undo failed for ${className}: ${reason}`,
          );
          return;
        }
        replLog.success(`restored ${className} (${undoStack.size} undo step(s) left)`);
        prevLayout = await fetchLayout(client, className);
        panel.update(prevLayout);
      } catch (err) {
        // Replay threw — re-push so the snapshot isn't lost, then report.
        undoStack.push(snapshot);
        const msg = (err as Error).message;
        createReplLog(label).error(msg);
        void vscode.window.showErrorMessage(
          `Modelica: undo failed for ${className}: ${msg}`,
        );
      }
    },
    onActionCheck: () => {
      // Re-use the existing user-triggered Check Model command: it
      // resolves the active diagram via `DiagramPanel.activeClassName()`,
      // serializes against live-check, populates diagnostics + REPL.
      void vscode.commands.executeCommand("modelica.checkModel");
    },
    onActionSimulate: async () => {
      try {
        const model = produceSimulationModel({
          className,
          options: await fetchSimulationOptions(client, className),
        });
        panel.openParameters({
          kind: "simulate",
          model,
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
        // Build the unit table host-side from the session cache (one set of
        // unit calls per base unit per session, shared with the labels), then
        // produce the form with each unit-bearing field's option list filled —
        // the webview renders the dropdown and converts locally.
        const unitTable = await buildComponentUnitTable(client, component);
        const form = buildComponentParameterForm(component, unitTable);
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
          model: form.model,
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
        const unitTable = await buildClassUnitTable(client, instance);
        const form = buildClassParameterForm(instance, unitTable);
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
          model: form.model,
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
        // Snapshot before the modifier writes so Undo reverts the whole
        // parameter-form submit in one step (#29).
        await pushUndoSnapshot();
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
        // Snapshot before the component modifier writes so Undo reverts the
        // whole sub-component parameter-form submit in one step (#29).
        await pushUndoSnapshot();
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
    onResetComponentParameters: async (componentName) => {
      // A double-click can fire two concurrent resets; the first owns the
      // re-fetch + re-open dance, the second is a no-op.
      if (resetInFlight) {
        return;
      }
      resetInFlight = true;
      try {
        // Bulk-clear the sub-component's modifiers (one RPC,
        // keepRedeclares=true) then refresh the model so the modal can
        // re-render with the type defaults the reset just exposed.
        const ok = await resetComponentParameters(
          client,
          className,
          componentName,
        );
        if (!ok) {
          // Clear failed — `resetComponentParameters` already logged +
          // toasted. Leave the modal as-is so the user keeps context.
          return;
        }
        // Re-open the component modal so its fields show the cleared
        // (defaulted) values. Re-derive the form from a fresh model
        // instance — same build path as onEditComponent — and refresh the
        // submit-translator closure state so a subsequent Apply diffs
        // against the post-reset baseline, not the stale pre-reset one.
        // One getModelInstance feeds both the layout refresh and the form
        // (via layoutFromInstance) instead of two back-to-back fetches.
        try {
          const instance = await fetchModelInstance(client, className);
          try {
            prevLayout = await layoutFromInstance(client, className, instance);
            panel.update(prevLayout);
          } catch (err) {
            log.error(
              "componentResetRefetch",
              `failed for ${className}`,
              err,
            );
          }
          const component = findSubComponent(instance, componentName);
          if (!component) {
            // The component vanished (shouldn't happen for a reset) — the
            // layout refresh above already reflects reality; close and
            // drop the stale submit-translator state so a later stray
            // submit can't act on refs from the now-closed modal.
            clearComponentParamState();
            panel.closeParameters();
            return;
          }
          const unitTable = await buildComponentUnitTable(client, component);
          const form = buildComponentParameterForm(component, unitTable);
          if (!form) {
            // No editable scalar params left after reset — nothing to
            // re-open; close and clear the stale closure state for the
            // same reason as the vanished-component branch.
            clearComponentParamState();
            panel.closeParameters();
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
            model: form.model,
            title: `Parameters: ${componentName}${typeName ? ` (${typeName})` : ""}`,
            submitLabel: "Apply",
            crefPrefix: componentName,
          });
        } catch (err) {
          log.error(
            "componentResetReopen",
            `failed for ${className}.${componentName}`,
            err,
          );
          void vscode.window.showErrorMessage(
            `Modelica: reset ${componentName} succeeded but re-opening the panel failed: ${(err as Error).message}`,
          );
        }
      } finally {
        resetInFlight = false;
      }
    },
    // ── Library browser ────────────────────────────────────────────────
    onLibraryListChildren: (parent) => librarySource.listChildren(parent),
    onLibrarySearch: (query) => librarySource.searchAll(query),
    // Lazy per-row icon thumbnail (issue #76, item 8): the cheap
    // `fetchIconLayout` path rendered to a self-contained SVG. Best-effort
    // — a fetch / render failure resolves to `undefined` so the browser
    // keeps its restriction-letter badge.
    onLibraryIcon: (target) => libraryIconSvg(client, target),
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
      // Snapshot before the addComponent write so Undo can revert it (#29).
      await pushUndoSnapshot();
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
    case "connectionRenamed":
      return `re-indexed ${edit.oldFrom} ↔ ${edit.oldTo} → ${edit.newFrom} ↔ ${edit.newTo}`;
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

async function fetchLayout(
  client: OmcClient,
  className: string,
): Promise<DiagramLayout> {
  const instance = await fetchModelInstance(client, className);
  return layoutFromInstance(client, className, instance);
}

/**
 * Build the display-ready `DiagramLayout` from an ALREADY-fetched
 * `ModelInstance`. Split out from `fetchLayout` so callers that need both
 * the layout and the form (the reset re-open) can share one
 * `getModelInstance` round-trip instead of paying for two back-to-back.
 */
async function layoutFromInstance(
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
function buildClassUnitTable(
  client: OmcClient,
  instance: ModelInstance,
): Promise<UnitTable> {
  return buildUnitTableForModel(client, produceParameterModel(instance), log.warn);
}

/**
 * Sub-component variant — produces the model from the component's type + its
 * parent-class overrides, then resolves its base units through the same cache.
 * Returns `undefined` for a primitive-typed leaf (no inspectable type).
 */
function buildComponentUnitTable(
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
async function fetchSimulationOptions(
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
    // Issue #76, item 9: the filtered call can return valid JSON with a
    // null / empty annotation (e.g. PID_Controller on the OM fork) — no
    // throw, but no Icon to paint either. Detecting that and falling back
    // to the full `getModelInstance` (which carries the inherited icon
    // layers) is what OMEdit does; a thrown error is only one of the two
    // ways the cheap path can come back unusable.
    if (hasIconAnnotation(annotationInstance)) {
      instance = annotationInstance;
    } else {
      log.warn(
        "fetchIconLayout",
        `getModelInstanceAnnotation returned no Icon for ${className}; falling back to full getModelInstance`,
      );
    }
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
 * browser (issue #76, item 8 — the consumer that makes `fetchIconLayout`
 * live). Best-effort: returns `undefined` on any failure or when the class
 * has no drawable icon layers, so the browser falls back to its
 * restriction-letter badge.
 */
async function libraryIconSvg(
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
 * True when the annotation-only instance carries a usable Icon somewhere in
 * its inheritance — either the host's own `annotation.Icon` or an `extends`
 * ancestor's. Mirrors how the producer collects icon layers up the chain, so
 * a class whose icon lives purely on a base class still counts as drawable.
 */
function hasIconAnnotation(mi: ModelInstance | undefined): boolean {
  if (mi === undefined || mi === null) return false;
  const ann = mi.annotation as { Icon?: unknown } | null | undefined;
  if (ann && ann.Icon != null) return true;
  for (const e of mi.elements ?? []) {
    if (e.$kind === "extends" && typeof e.baseClass === "object") {
      if (hasIconAnnotation(e.baseClass)) return true;
    }
  }
  return false;
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
