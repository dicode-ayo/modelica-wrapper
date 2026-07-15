import { afterEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";

import {
  closedTabs,
  executedCommands,
  resetTabs,
  setTabGroups,
  type Tab,
} from "../test-support/vscode-mock.js";
import {
  DIAGRAM_VIEW_TYPE,
  DOCUMENTATION_VIEW_TYPE,
  ICON_VIEW_TYPE,
} from "./diagram/view-type.js";
import { sourceUriFor } from "./source-provider.js";

import { recoverRestoredCustomEditors } from "./restore-recovery.js";

function customTab(className: string, viewType: string, isDirty = false): Tab {
  return {
    input: new vscode.TabInputCustom(sourceUriFor(className), viewType),
    isDirty,
  };
}

function openWithCalls(): { command: string; args: unknown[] }[] {
  return executedCommands.filter((c) => c.command === "vscode.openWith");
}

describe("recoverRestoredCustomEditors", () => {
  afterEach(() => {
    resetTabs();
    executedCommands.length = 0;
  });

  it("closes and re-opens a restored Modelica custom editor, preserving its column", async () => {
    const className = "Modelica.Blocks.Continuous.PID";
    const tab = customTab(className, DIAGRAM_VIEW_TYPE);
    setTabGroups([{ viewColumn: 2, tabs: [tab] }]);

    await recoverRestoredCustomEditors();

    expect(closedTabs).toEqual([tab]);
    const opens = openWithCalls();
    expect(opens).toHaveLength(1);
    expect(opens[0]?.args).toEqual([
      sourceUriFor(className),
      DIAGRAM_VIEW_TYPE,
      2,
    ]);
  });

  it("recovers each view type and walks every group", async () => {
    const diagram = customTab("A", DIAGRAM_VIEW_TYPE);
    const icon = customTab("B", ICON_VIEW_TYPE);
    const doc = customTab("C", DOCUMENTATION_VIEW_TYPE);
    setTabGroups([
      { viewColumn: 1, tabs: [diagram, icon] },
      { viewColumn: 3, tabs: [doc] },
    ]);

    await recoverRestoredCustomEditors();

    expect(closedTabs).toEqual([diagram, icon, doc]);
    const opens = openWithCalls();
    expect(opens.map((o) => o.args[1])).toEqual([
      DIAGRAM_VIEW_TYPE,
      ICON_VIEW_TYPE,
      DOCUMENTATION_VIEW_TYPE,
    ]);
    expect(opens.map((o) => o.args[2])).toEqual([1, 1, 3]);
  });

  it("leaves a dirty tab untouched so a re-open can't discard an edit", async () => {
    const dirty = customTab("Foo", DIAGRAM_VIEW_TYPE, true);
    setTabGroups([{ viewColumn: 1, tabs: [dirty] }]);

    await recoverRestoredCustomEditors();

    expect(closedTabs).toHaveLength(0);
    expect(openWithCalls()).toHaveLength(0);
  });

  it("ignores text tabs, on-disk files, and other extensions' custom editors", async () => {
    const text: Tab = { input: new vscode.TabInputText(sourceUriFor("Foo")) };
    const onDisk: Tab = {
      input: new vscode.TabInputCustom(
        vscode.Uri.file("/tmp/Foo.mo"),
        DIAGRAM_VIEW_TYPE,
      ),
    };
    const foreign = customTab("Bar", "modelica.resultView");
    setTabGroups([{ viewColumn: 1, tabs: [text, onDisk, foreign] }]);

    await recoverRestoredCustomEditors();

    expect(closedTabs).toHaveLength(0);
    expect(openWithCalls()).toHaveLength(0);
  });
});
