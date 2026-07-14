import { afterEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";

import {
  closedTabs,
  resetTabs,
  setActiveGroupTabs,
  setActiveTextEditorUri,
  type Tab,
} from "../../test-support/vscode-mock.js";
import { DIAGRAM_VIEW_TYPE, ICON_VIEW_TYPE } from "../diagram/view-type.js";
import { sourceUriFor } from "../source-provider.js";

import { switchView } from "./diagram.js";

/** The built-in text editor id — the `openWith` override for the text view. */
const TEXT_VIEW = "default";

function textTab(className: string): Tab {
  return { input: new vscode.TabInputText(sourceUriFor(className)) };
}

function customTab(className: string, viewType: string): Tab {
  return {
    input: new vscode.TabInputCustom(sourceUriFor(className), viewType),
  };
}

describe("switchView", () => {
  afterEach(() => {
    resetTabs();
    setActiveTextEditorUri(undefined);
  });

  it("closes the source view's tab but not the freshly-switched target tab", async () => {
    setActiveTextEditorUri(sourceUriFor("Foo"));
    const target = customTab("Foo", ICON_VIEW_TYPE);
    const source = customTab("Foo", DIAGRAM_VIEW_TYPE);
    const other = customTab("Bar", DIAGRAM_VIEW_TYPE);
    setActiveGroupTabs([target, source, other]);

    await switchView(ICON_VIEW_TYPE);

    expect(closedTabs).toContain(source);
    expect(closedTabs).not.toContain(target);
    expect(closedTabs).not.toContain(other);
  });

  it("switching to text closes a custom-view tab of the same class", async () => {
    setActiveTextEditorUri(sourceUriFor("Foo"));
    const target = textTab("Foo");
    const source = customTab("Foo", DIAGRAM_VIEW_TYPE);
    setActiveGroupTabs([target, source]);

    await switchView(TEXT_VIEW);

    expect(closedTabs).toEqual([source]);
  });

  it("does not close a same-resource tab that IS the target view", async () => {
    setActiveTextEditorUri(sourceUriFor("Foo"));
    setActiveGroupTabs([customTab("Foo", DIAGRAM_VIEW_TYPE)]);

    await switchView(DIAGRAM_VIEW_TYPE);

    expect(closedTabs).toHaveLength(0);
  });
});
