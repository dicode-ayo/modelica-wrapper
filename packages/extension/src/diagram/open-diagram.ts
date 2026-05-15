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
import { diffLayouts, lineAnnotation } from "./diff-layout.js";
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

  const panel = DiagramPanel.open(context.extensionUri, className, prevLayout, {
    onChange: async (next) => {
      const edits = diffLayouts(prevLayout, next);
      if (edits.length === 0) {
        return;
      }
      const result = await applyEdits(client, className, edits);
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
    onConnectionCreate: async (fromKey, toKey) => {
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
          annotation: lineAnnotation([]),
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
  });
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
 * Maps a UI entity key (`c:R1`, `k:p`) to the omc-client connector
 * reference (`R1.p` or `p`). The host class itself owns standalone
 * connectors directly; nested connectors live under a component.
 */
function keyToCref(layout: DiagramLayout, key: string): string | null {
  const idx = key.indexOf(":");
  if (idx < 0) {
    return null;
  }
  const prefix = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if (prefix === "k") {
    // Could be host-level connector OR a port nested in a component;
    // we can't tell from the bare key without context. The current
    // emit path is `k:<portName>` for both. Prefer a match against
    // host-level connectors first, then look for a component port
    // exposing that name.
    if (layout.connectors[id]) {
      return id;
    }
    for (const [compName, comp] of Object.entries(layout.components)) {
      const cls = layout.classes[comp.classRef];
      if (cls && cls.connectors[id]) {
        return `${compName}.${id}`;
      }
    }
    return id;
  }
  return null;
}
