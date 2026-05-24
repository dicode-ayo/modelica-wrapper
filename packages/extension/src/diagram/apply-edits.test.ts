/**
 * Unit tests for `applyEdits` (issue #76, root cause + items 7 & 13).
 *
 * `client.invoke` resolves — never throws — on an OMC-rejected mutation,
 * returning `{ success: false, diagnostic? }`. Before the fix, `applyEdits`
 * blindly counted every resolved call as `applied++`, so a rejected
 * connection / placement write was logged as a success and the user's edit
 * was silently lost. These tests pin the corrected behaviour: a
 * `{ success: false }` lands in `result.failed` with the diagnostic.
 */

import { describe, expect, it, vi } from "vitest";
import type { OmcClient } from "@dicode/omc-client";

import { applyEdits } from "./apply-edits.js";
import type { LayoutEdit } from "./diff-layout.js";

type InvokeResult = { success: boolean; diagnostic?: string };

/**
 * Mock client whose `invoke` returns the queued result per call (FIFO).
 * `lastCall` is a static label so the hook has something to read.
 */
function mockClient(
  results: InvokeResult[],
): { client: OmcClient; invoke: ReturnType<typeof vi.fn> } {
  let i = 0;
  const invoke = vi.fn(async () => results[i++] ?? { success: true });
  const client = {
    invoke,
    get lastCall() {
      return "stub(...)";
    },
  } as unknown as OmcClient;
  return { client, invoke };
}

const placement: LayoutEdit = {
  kind: "componentPlacement",
  componentName: "gain",
  componentClass: "Modelica.Blocks.Math.Gain",
  extent: [
    [-10, -10],
    [10, 10],
  ],
  rotation: 0,
};

const addConn: LayoutEdit = {
  kind: "connectionAdded",
  from: "a.p",
  to: "b.n",
  waypoints: [],
};

describe("applyEdits: success accounting", () => {
  it("counts a clean success as applied", async () => {
    const { client } = mockClient([{ success: true }]);
    const result = await applyEdits(client, "MyPkg.M", [placement]);
    expect(result.applied).toBe(1);
    expect(result.failed).toEqual([]);
  });

  it("routes a { success: false } result into failed, not applied", async () => {
    const { client } = mockClient([
      { success: false, diagnostic: "OMC: component not found" },
    ]);
    const result = await applyEdits(client, "MyPkg.M", [placement]);
    expect(result.applied).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.edit).toBe(placement);
    expect(result.failed[0]!.error).toContain("OMC: component not found");
  });

  it("falls back to a generic message when no diagnostic accompanies the false", async () => {
    const { client } = mockClient([{ success: false }]);
    const result = await applyEdits(client, "MyPkg.M", [addConn]);
    expect(result.applied).toBe(0);
    expect(result.failed[0]!.error).toMatch(/addConnection.*failure/);
  });

  it("partitions a mixed batch: clean success applied, rejected one failed", async () => {
    // Edits are reordered (deletes/adds before placement); make both
    // succeed-vs-fail unambiguous by giving each a distinct result.
    const { client, invoke } = mockClient([
      { success: true }, // addConnection (ordered first)
      { success: false, diagnostic: "rejected placement" }, // updateComponent
    ]);
    const result = await applyEdits(client, "MyPkg.M", [placement, addConn]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.error).toContain("rejected placement");
  });
});

describe("applyEdits: snapshot rollback option (issue #76, item 14)", () => {
  /**
   * Mock client that also serves the snapshot capture/restore I/O
   * (`listFile` / `getSourceFile` / `loadString`) so `{ snapshot: true }`
   * can take and replay a snapshot.
   */
  function snapshotClient(results: InvokeResult[]): {
    client: OmcClient;
    loadString: ReturnType<typeof vi.fn>;
  } {
    let i = 0;
    const invoke = vi.fn(async () => results[i++] ?? { success: true });
    const loadString = vi.fn(async () => ({ success: true }));
    const client = {
      invoke,
      listFile: vi.fn(async () => ({ contents: "model M\nend M;\n" })),
      getSourceFile: vi.fn(async () => ({ fileName: "/ws/M.mo" })),
      loadString,
      get lastCall() {
        return "stub(...)";
      },
    } as unknown as OmcClient;
    return { client, loadString };
  }

  it("rolls back the batch when an edit fails", async () => {
    const { client, loadString } = snapshotClient([
      { success: false, diagnostic: "boom" },
    ]);
    const result = await applyEdits(client, "M", [placement], undefined, {
      snapshot: true,
    });
    expect(result.failed).toHaveLength(1);
    expect(result.rolledBack).toBe(true);
    // The captured source was replayed via loadString to undo the batch.
    expect(loadString).toHaveBeenCalledWith(
      expect.objectContaining({ data: "model M\nend M;\n", merge: false }),
    );
  });

  it("does not roll back when every edit succeeds", async () => {
    const { client, loadString } = snapshotClient([{ success: true }]);
    const result = await applyEdits(client, "M", [placement], undefined, {
      snapshot: true,
    });
    expect(result.failed).toHaveLength(0);
    expect(result.rolledBack).toBe(false);
    expect(loadString).not.toHaveBeenCalled();
  });

  it("default path (no option) takes no snapshot and never rolls back", async () => {
    const { client, loadString } = snapshotClient([{ success: false }]);
    const result = await applyEdits(client, "M", [placement]);
    expect(result.failed).toHaveLength(1);
    expect(result.rolledBack).toBe(false);
    expect(loadString).not.toHaveBeenCalled();
  });
});
