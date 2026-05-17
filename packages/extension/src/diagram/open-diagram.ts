import * as vscode from "vscode";
import {
  OmcClient,
  asString,
  diagram,
  type DiagramLayout,
  type Value,
} from "@modelica-wrapper/omc-client";

import { createReplLog } from "../commands/repl.js";
import { log } from "../logger.js";

import { applyEdits } from "./apply-edits.js";
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
      try {
        await client.invoke("addConnection", {
          from,
          to,
          typeName: className,
          annotation: lineAnnotation(waypoints),
        });
        prevLayout = await fetchLayout(client, className);
        panel.update(prevLayout);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Modelica: addConnection failed: ${(err as Error).message}`,
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
    onActionParameters: () => {
      // Phase 4 hook — for now surface a stub so the button isn't a no-op
      // and we can see end-to-end that the message round-trips.
      void vscode.window.showInformationMessage(
        "Modelica: component-parameter editing is coming soon.",
      );
    },
    // ── Parameter modal ────────────────────────────────────────────────
    onParametersSubmit: async (kind, values) => {
      if (kind === "simulate") {
        await runSimulate(client, className, values);
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
  const { instance } = await client.invoke("getModelInstance", {
    typeName: className,
  });
  return diagram.produceDiagramLayout(instance, "diagram");
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
 * connector reference. Standalone connectors carry the bare port name;
 * nested connectors arrive pre-qualified as `<compName>.<portName>`
 * thanks to `entityKeyForNode`'s parent walk, so this is now a direct
 * pass-through with light validation against the current layout.
 */
function keyToCref(layout: DiagramLayout, key: string): string | null {
  const idx = key.indexOf(":");
  if (idx < 0) {
    return null;
  }
  const prefix = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if (prefix !== "k") {
    return null;
  }
  const dot = id.indexOf(".");
  if (dot < 0) {
    return layout.connectors[id] ? id : null;
  }
  const compName = id.slice(0, dot);
  const portName = id.slice(dot + 1);
  const comp = layout.components[compName];
  if (!comp) {
    return null;
  }
  const cls = layout.classes[comp.classRef];
  if (!cls || !cls.connectors[portName]) {
    return null;
  }
  return id;
}
