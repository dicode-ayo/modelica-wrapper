/**
 * The shadow buffer reflects canonical OMC source into the editor document and
 * guards its own writes from the foreign-change path. These pin that guard: a
 * self-write must not trigger `onForeignChange` (or reflect → change →
 * re-sync → reflect would ping-pong), while a genuine external edit must.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
  appliedEdits,
  completeApply,
  emitChange,
  pendingApplies,
  setApplyEditManual,
  setApplyEditResult,
} from "../../test-support/vscode-mock.js";

import { createShadowBuffer } from "./shadow-buffer.js";

function docFor(uri: vscode.Uri): vscode.TextDocument {
  return { uri, lineCount: 0 } as unknown as vscode.TextDocument;
}

const DOC_URI = vscode.Uri.parse("modelica-source:/Pkg.Model.mo");

beforeEach(() => {
  appliedEdits.length = 0;
  pendingApplies.length = 0;
  setApplyEditManual(false);
  setApplyEditResult(true);
});

describe("createShadowBuffer", () => {
  it("writes the text via a WorkspaceEdit without triggering onForeignChange", async () => {
    const onForeign = vi.fn();
    const buffer = createShadowBuffer(docFor(DOC_URI), onForeign);

    await buffer.write("model Pkg.Model end Pkg.Model;");

    expect(appliedEdits).toHaveLength(1);
    expect(appliedEdits[0]?.replacements[0]?.text).toBe(
      "model Pkg.Model end Pkg.Model;",
    );
    // applyEdit fires the change event while our self-write flag is set.
    expect(onForeign).not.toHaveBeenCalled();
    buffer.dispose();
  });

  it("routes a foreign change (no write in flight) to onForeignChange", () => {
    const onForeign = vi.fn();
    const buffer = createShadowBuffer(docFor(DOC_URI), onForeign);

    emitChange({ document: { uri: DOC_URI } });

    expect(onForeign).toHaveBeenCalledTimes(1);
    buffer.dispose();
  });

  it("ignores changes to other documents", () => {
    const onForeign = vi.fn();
    const buffer = createShadowBuffer(docFor(DOC_URI), onForeign);

    emitChange({
      document: { uri: vscode.Uri.parse("modelica-source:/Other.mo") },
    });

    expect(onForeign).not.toHaveBeenCalled();
    buffer.dispose();
  });

  it("stops routing after dispose", () => {
    const onForeign = vi.fn();
    const buffer = createShadowBuffer(docFor(DOC_URI), onForeign);
    buffer.dispose();

    emitChange({ document: { uri: DOC_URI } });

    expect(onForeign).not.toHaveBeenCalled();
  });

  it("keeps overlapping writes out of the foreign path (counter, not boolean)", async () => {
    setApplyEditManual(true);
    const onForeign = vi.fn();
    const buffer = createShadowBuffer(docFor(DOC_URI), onForeign);

    // Two writes in flight at once. Completing the first (which fires its
    // change and lets its `finally` run) must not release the guard for the
    // second's still-pending change — a boolean flag would misfire here.
    const first = buffer.write("A");
    const second = buffer.write("B");

    completeApply(0);
    await first;
    completeApply(1);
    await second;

    expect(onForeign).not.toHaveBeenCalled();
    buffer.dispose();
  });

  it("throws when applyEdit rejects the write, so a failed reflect surfaces", async () => {
    setApplyEditResult(false);
    const buffer = createShadowBuffer(docFor(DOC_URI), vi.fn());

    await expect(buffer.write("A")).rejects.toThrow(/applyEdit rejected/);
    buffer.dispose();
  });
});
