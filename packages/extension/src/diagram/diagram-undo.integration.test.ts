/**
 * Integration test for the diagram-local snapshot undo (issue #29, deferred
 * half).
 *
 * The user-facing undo wiring lives in `open-diagram.ts` and depends on
 * VSCode (panel, toasts, REPL), so it can't be exercised end-to-end here.
 * What we CAN exercise against real OMC is the exact host-side mechanism the
 * undo handler uses: push `captureSnapshot` onto a `SnapshotStack` before a
 * mutation, then pop + `restoreSnapshot` and confirm the mutation is gone —
 * verified via `getComponents` (the same evidence the unit `omc-snapshot`
 * integration test trusts) and a `listFile` shape check.
 *
 * Auto-skips when OMC isn't on PATH; honours `OMC_INTEGRATION=0/1` like the
 * rest of the integration suite.
 */

import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OmcClient } from "@dicode/omc-client";

import { captureSnapshot, restoreSnapshot } from "./omc-snapshot.js";
import { SnapshotStack } from "./snapshot-stack.js";

function shouldRun(): boolean {
  const flag = process.env.OMC_INTEGRATION;
  if (flag === "0") return false;
  if (flag === "1") return true;
  if (process.env.OMC_PATH && process.env.OMC_PATH.length > 0) return true;
  try {
    execSync(process.platform === "win32" ? "where omc" : "command -v omc", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const describeIf = shouldRun() ? describe : describe.skip;

const FIXTURE = `model UndoHost
  Real keep = 1;
end UndoHost;
`;

async function loadFixture(client: OmcClient): Promise<void> {
  const { success } = await client.loadString({
    data: FIXTURE,
    filename: "<runtime:UndoHost>",
    merge: true,
  });
  if (!success) {
    const { errorString } = await client.getErrorString();
    throw new Error(`fixture load failed: ${errorString}`);
  }
}

async function componentNames(client: OmcClient): Promise<string[]> {
  const { components } = await client.getComponents({ typeName: "UndoHost" });
  return components.map((c) => c.name).sort();
}

describeIf("diagram-local undo integration", () => {
  let client: OmcClient;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    await loadFixture(client);
  });

  afterEach(async () => {
    await client.close();
  });

  it("push → mutate → pop+restore reverts the OMC state", async () => {
    const undoStack = new SnapshotStack();
    expect(await componentNames(client)).toEqual(["keep"]);

    // Mimic the open-diagram closure: snapshot BEFORE the mutating op.
    undoStack.push(await captureSnapshot(client, "UndoHost"));
    expect(undoStack.size).toBe(1);

    // Mutate via a real OMC write (the addComponent flow).
    const { success } = await client.addComponent({
      componentName: "added",
      componentClass: "Real",
      intoTypeName: "UndoHost",
    });
    expect(success).toBe(true);
    expect(await componentNames(client)).toEqual(["added", "keep"]);

    // Undo: pop the snapshot and replay it.
    const snapshot = undoStack.pop();
    expect(snapshot).toBeDefined();
    const restored = await restoreSnapshot(client, snapshot!);
    expect(restored).toBe(true);

    // The mutation is gone — undo actually restored OMC state.
    expect(await componentNames(client)).toEqual(["keep"]);
    expect(undoStack.isEmpty).toBe(true);

    // listFile shape matches the pre-mutation source too.
    const { contents } = await client.listFile({ typeName: "UndoHost" });
    expect(contents).toContain("Real keep");
    expect(contents).not.toContain("added");
  });

  it("multiple edits unwind one step at a time (LIFO)", async () => {
    const undoStack = new SnapshotStack();

    undoStack.push(await captureSnapshot(client, "UndoHost"));
    await client.addComponent({
      componentName: "one",
      componentClass: "Real",
      intoTypeName: "UndoHost",
    });

    undoStack.push(await captureSnapshot(client, "UndoHost"));
    await client.addComponent({
      componentName: "two",
      componentClass: "Real",
      intoTypeName: "UndoHost",
    });
    expect(await componentNames(client)).toEqual(["keep", "one", "two"]);

    // First undo removes the most-recent edit only ("two").
    await restoreSnapshot(client, undoStack.pop()!);
    expect(await componentNames(client)).toEqual(["keep", "one"]);

    // Second undo removes "one".
    await restoreSnapshot(client, undoStack.pop()!);
    expect(await componentNames(client)).toEqual(["keep"]);
    expect(undoStack.isEmpty).toBe(true);
  });

  it("empty stack pop yields undefined (nothing-to-undo path)", () => {
    const undoStack = new SnapshotStack();
    expect(undoStack.pop()).toBeUndefined();
  });
});
