/**
 * Integration test for the OMC-level undo escape hatch (issue #29).
 *
 * Exercises the real `listFile` snapshot + `loadString` restore round-trip
 * against a live OMC, plus the `applyEdits({ snapshot: true })` rollback path.
 *
 *  1. Load a fixture model, snapshot it, mutate it via `addComponent`, then
 *     `restoreSnapshot` and assert the added component is gone.
 *  2. Drive `applyEdits` with `{ snapshot: true }` and an edit list that
 *     contains a failing edit (delete a nonexistent component). Assert the
 *     result reports `rolledBack` and that the model matches the snapshot.
 *
 * Auto-skips when OMC isn't on PATH; honours `OMC_INTEGRATION=0/1` the same
 * way the rest of the integration suite does.
 */

import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OmcClient } from "@modelica-wrapper/omc-client";

import { applyEdits } from "./apply-edits.js";
import type { LayoutEdit } from "./diff-layout.js";
import { captureSnapshot, restoreSnapshot } from "./omc-snapshot.js";

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

// A self-contained model with one component, so we can add a second one and
// confirm the snapshot rolls it back. No external library dependency — the
// component type is a local record so the fixture loads on any OMC.
const FIXTURE = `model SnapHost
  Real keep = 1;
end SnapHost;
`;

async function loadFixture(client: OmcClient): Promise<void> {
  const { success } = await client.loadString({
    data: FIXTURE,
    filename: "<runtime:SnapHost>",
    merge: true,
  });
  if (!success) {
    const { errorString } = await client.getErrorString();
    throw new Error(`fixture load failed: ${errorString}`);
  }
}

async function componentNames(client: OmcClient): Promise<string[]> {
  const { components } = await client.getComponents({ typeName: "SnapHost" });
  return components.map((c) => c.name).sort();
}

/**
 * Wrap `client` so a single `invoke(fnToFail, …)` rejects, while every other
 * call (including capture's `listFile`/`getSourceFile` and restore's
 * `loadString`) passes through to the real OMC. `applyOne` routes edits via
 * `client.invoke`, so intercepting `invoke` is what surfaces a thrown edit.
 */
function proxyFailingInvoke(client: OmcClient, fnToFail: string): OmcClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "invoke") {
        return async (fn: string, input: unknown) => {
          if (fn === fnToFail) {
            throw new Error(`simulated RPC failure: ${fn}`);
          }
          return (target.invoke as (f: string, i: unknown) => Promise<unknown>)(
            fn,
            input,
          );
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as OmcClient;
}

describeIf("omc-snapshot integration", () => {
  let client: OmcClient;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    await loadFixture(client);
  });

  afterEach(async () => {
    await client.close();
  });

  it("capture → mutate → restore removes the mutation", async () => {
    expect(await componentNames(client)).toEqual(["keep"]);

    const snap = await captureSnapshot(client, "SnapHost");
    expect(snap).toBeDefined();
    expect(snap?.contents).toContain("Real keep");

    // Mutate: add a component the snapshot doesn't know about.
    const { success } = await client.addComponent({
      componentName: "added",
      componentClass: "Real",
      intoTypeName: "SnapHost",
    });
    expect(success).toBe(true);
    expect(await componentNames(client)).toEqual(["added", "keep"]);

    // Restore: the added component should be gone.
    const restored = await restoreSnapshot(client, snap!);
    expect(restored).toBe(true);
    expect(await componentNames(client)).toEqual(["keep"]);
  });

  it("applyEdits({ snapshot: true }) rolls back when an edit throws", async () => {
    // NOTE on why we force a throw rather than relying on OMC: the editing
    // wrappers used by `applyOne` (deleteComponent, addConnection, …) return
    // `{ success: false }` instead of throwing when the target is missing —
    // OMC treats e.g. "delete a nonexistent component" as a lenient no-op.
    // `applyOne` only inspects thrown errors, so the realistic way to drive
    // the failure path is a rejected RPC. We proxy the real client so
    // `addConnection` rejects (a transport-style failure), while capture
    // (listFile/getSourceFile) and restore (loadString) still hit real OMC —
    // exercising the genuine source-text round-trip through OMC.
    //
    // First, place an extra component on disk so the snapshot has something
    // to undo: applyEdits will delete it (succeeds) then hit the throwing
    // addConnection, and the snapshot — taken before either ran — must bring
    // it back.
    await client.addComponent({
      componentName: "doomed",
      componentClass: "Real",
      intoTypeName: "SnapHost",
    });
    expect(await componentNames(client)).toEqual(["doomed", "keep"]);

    // `applyOne` dispatches edits through `client.invoke(fn, …)`, so we
    // intercept `invoke` and reject only the `addConnection` call.
    const failing = proxyFailingInvoke(client, "addConnection");

    const edits: LayoutEdit[] = [
      // Runs first (order 1) and succeeds against real OMC.
      { kind: "componentDeleted", componentName: "doomed" },
      // Runs after (order 2) and throws via the proxy → triggers rollback.
      { kind: "connectionAdded", from: "a.x", to: "b.y", waypoints: [] },
    ];

    const result = await applyEdits(failing, "SnapHost", edits, undefined, {
      snapshot: true,
    });

    expect(result.failed.length).toBe(1);
    expect(result.failed[0]?.edit.kind).toBe("connectionAdded");
    expect(result.rolledBack).toBe(true);
    // Snapshot was taken before any edit ran, so rollback restores the
    // pre-applyEdits shape — "doomed" (which the first edit deleted) is back.
    expect(await componentNames(client)).toEqual(["doomed", "keep"]);
  });

  it("round-trips a PACKAGE-NESTED class (issue #76, item 2)", async () => {
    // The bug: listFile(Pkg.Inner) returns only `model Inner … end Inner;`.
    // Restoring that bare body with merge=false used to re-establish Inner at
    // the top level (or fail to replace the package member). The within-clause
    // the snapshot now prepends keeps it inside Pkg on restore.
    const { randomBytes } = await import("node:crypto");
    const pkg = `MwNest_${randomBytes(4).toString("hex")}`;
    const inner = `${pkg}.Inner`;
    const load = await client.loadString({
      data: `package ${pkg}
  model Inner
    Real keep = 1;
  end Inner;
end ${pkg};
`,
      filename: `<runtime:${pkg}>`,
      merge: true,
    });
    expect(load.success).toBe(true);

    try {
      const innerComponents = async (): Promise<string[]> => {
        const { components } = await client.getComponents({ typeName: inner });
        return components.map((c) => c.name).sort();
      };
      expect(await innerComponents()).toEqual(["keep"]);

      const snap = await captureSnapshot(client, inner);
      expect(snap).toBeDefined();
      expect(snap?.contents).toMatch(new RegExp(`^within ${pkg};`));

      // Mutate the nested class, then restore.
      await client.addComponent({
        componentName: "added",
        componentClass: "Real",
        intoTypeName: inner,
      });
      expect(await innerComponents()).toEqual(["added", "keep"]);

      const restored = await restoreSnapshot(client, snap!);
      expect(restored).toBe(true);

      // The nested class must still resolve under its package AND the
      // mutation must be gone — proving the restore landed inside Pkg, not
      // at the top level.
      expect(await client.existClass({ typeName: inner })).toMatchObject({
        exists: true,
      });
      expect(await innerComponents()).toEqual(["keep"]);
    } finally {
      await client.deleteClass({ typeName: pkg });
    }
  });

  it("applyEdits without options does not snapshot or roll back", async () => {
    // A throwing edit, no snapshot option → failure is recorded but no
    // rollback happens (rolledBack stays false; the default path is
    // unchanged).
    const failing = proxyFailingInvoke(client, "addConnection");

    const edits: LayoutEdit[] = [
      { kind: "connectionAdded", from: "a.x", to: "b.y", waypoints: [] },
    ];
    const result = await applyEdits(failing, "SnapHost", edits);
    expect(result.failed.length).toBe(1);
    expect(result.rolledBack).toBe(false);
  });
});
