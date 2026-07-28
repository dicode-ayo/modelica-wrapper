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
import type { OmcClient, RectangleShape } from "@dicode/omc-client";

import { applyEdits } from "./apply-edits.js";
import type { LayoutEdit } from "./diff-layout.js";

type InvokeResult = { success: boolean; diagnostic?: string };

/**
 * Mock client whose `invoke` returns the queued result per call (FIFO).
 * `lastCall` is a static label so the hook has something to read.
 */
function mockClient(results: InvokeResult[]): {
  client: OmcClient;
  invoke: ReturnType<typeof vi.fn>;
} {
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
  transformation: {
    extent: [
      [-10, -10],
      [10, 10],
    ],
  },
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

describe("applyEdits: graphics", () => {
  const shape: RectangleShape = {
    kind: "rectangle",
    extent: [
      [0, 0],
      [10, 10],
    ],
  };

  it("dispatches graphicsAdded as a writeClassGraphics add op", async () => {
    const { client, invoke } = mockClient([{ success: true }]);
    const edit: LayoutEdit = { kind: "graphicsAdded", layer: "icon", shape };
    const result = await applyEdits(client, "MyPkg.M", [edit]);
    expect(result.applied).toBe(1);
    expect(invoke).toHaveBeenCalledWith("writeClassGraphics", {
      typeName: "MyPkg.M",
      layer: "icon",
      op: { kind: "add", shape },
    });
  });

  it("dispatches graphicsModified with its index", async () => {
    const { client, invoke } = mockClient([{ success: true }]);
    const edit: LayoutEdit = {
      kind: "graphicsModified",
      layer: "diagram",
      index: 2,
      shape,
    };
    await applyEdits(client, "MyPkg.M", [edit]);
    expect(invoke).toHaveBeenCalledWith("writeClassGraphics", {
      typeName: "MyPkg.M",
      layer: "diagram",
      op: { kind: "modify", index: 2, shape },
    });
  });

  it("dispatches graphicsDeleted with its index", async () => {
    const { client, invoke } = mockClient([{ success: true }]);
    const edit: LayoutEdit = {
      kind: "graphicsDeleted",
      layer: "icon",
      index: 1,
    };
    await applyEdits(client, "MyPkg.M", [edit]);
    expect(invoke).toHaveBeenCalledWith("writeClassGraphics", {
      typeName: "MyPkg.M",
      layer: "icon",
      op: { kind: "delete", index: 1 },
    });
  });

  it("routes a rejected graphics write into failed", async () => {
    const { client } = mockClient([
      { success: false, diagnostic: "bad shape" },
    ]);
    const edit: LayoutEdit = { kind: "graphicsAdded", layer: "icon", shape };
    const result = await applyEdits(client, "MyPkg.M", [edit]);
    expect(result.applied).toBe(0);
    expect(result.failed[0]!.error).toContain("bad shape");
  });

  it("orders modify → delete → add so indices stay valid", async () => {
    const { client, invoke } = mockClient([{ success: true }]);
    const add: LayoutEdit = { kind: "graphicsAdded", layer: "icon", shape };
    const del: LayoutEdit = {
      kind: "graphicsDeleted",
      layer: "icon",
      index: 2,
    };
    const mod: LayoutEdit = {
      kind: "graphicsModified",
      layer: "icon",
      index: 0,
      shape,
    };
    await applyEdits(client, "MyPkg.M", [add, del, mod]);
    const ops = invoke.mock.calls.map((c) => c[1].op.kind);
    expect(ops).toEqual(["modify", "delete", "add"]);
  });
});

describe("applyEdits: connection style round-trip (issue #219)", () => {
  it("threads edit.style into the addConnection annotation", async () => {
    const { client, invoke } = mockClient([{ success: true }]);
    const edit: LayoutEdit = {
      kind: "connectionAdded",
      from: "a.p",
      to: "b.n",
      waypoints: [[0, 0]],
      style: { color: [255, 0, 0], thickness: 0.5 },
    };
    await applyEdits(client, "MyPkg.M", [edit]);
    expect(invoke).toHaveBeenCalledWith("addConnection", {
      from: "a.p",
      to: "b.n",
      typeName: "MyPkg.M",
      annotation: "Line(points={{0,0}},color={255,0,0},thickness=0.5)",
    });
  });

  it("threads edit.style into the updateConnection annotation", async () => {
    const { client, invoke } = mockClient([{ success: true }]);
    const edit: LayoutEdit = {
      kind: "connectionWaypoints",
      from: "a.p",
      to: "b.n",
      waypoints: [[5, 0]],
      style: { pattern: "Dash" },
    };
    await applyEdits(client, "MyPkg.M", [edit]);
    expect(invoke).toHaveBeenCalledWith("updateConnection", {
      typeName: "MyPkg.M",
      from: "a.p",
      to: "b.n",
      annotation: "Line(points={{5,0}},pattern=LinePattern.Dash)",
    });
  });
});
