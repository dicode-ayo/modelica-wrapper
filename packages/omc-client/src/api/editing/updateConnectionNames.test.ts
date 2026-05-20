/**
 * Wrapper-level tests for `updateConnectionNames` (issue #76, item 13).
 *
 * Like `updateConnection`, this mutator now routes through
 * `parseMutationDiagnostic` so a `false` carries OMC's diagnostic prose
 * instead of being silently indistinguishable from success.
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";

import { updateConnectionNames } from "./updateConnectionNames.js";

function stubCtx(response: string): { ctx: CallContext; sent: string[] } {
  const sent: string[] = [];
  const ctx: CallContext = {
    async call(cmd) {
      sent.push(cmd);
      return response;
    },
    async getErrorString() {
      return { errorString: "" };
    },
  };
  return { ctx, sent };
}

describe("updateConnectionNames: response parsing", () => {
  it("returns success=true on a clean true response", async () => {
    const { ctx } = stubCtx("true");
    const out = await updateConnectionNames(ctx, {
      typeName: "MyPkg.M",
      from: "pins[1].p",
      to: "ground.p",
      fromNew: "pins[2].p",
      toNew: "ground.p",
    });
    expect(out).toEqual({ success: true });
  });

  it("returns success=false on a plain false response", async () => {
    const { ctx } = stubCtx("false");
    const out = await updateConnectionNames(ctx, {
      typeName: "MyPkg.M",
      from: "pins[1].p",
      to: "ground.p",
      fromNew: "pins[2].p",
      toNew: "ground.p",
    });
    expect(out).toEqual({ success: false });
  });

  it("captures the trailing diagnostic on a failure line", async () => {
    const { ctx } = stubCtx("false\nError: endpoint not found");
    const out = await updateConnectionNames(ctx, {
      typeName: "MyPkg.M",
      from: "pins[1].p",
      to: "ground.p",
      fromNew: "pins[2].p",
      toNew: "ground.p",
    });
    expect(out).toEqual({
      success: false,
      diagnostic: "Error: endpoint not found",
    });
  });
});

describe("updateConnectionNames: outgoing command shape", () => {
  it("quotes all four endpoint strings with className first", async () => {
    const { ctx, sent } = stubCtx("true");
    await updateConnectionNames(ctx, {
      typeName: "MyPkg.M",
      from: "pins[1].p",
      to: "ground.p",
      fromNew: "pins[2].p",
      toNew: "ground.p",
    });
    expect(sent).toEqual([
      'updateConnectionNames(MyPkg.M, "pins[1].p", "ground.p", "pins[2].p", "ground.p")',
    ]);
  });
});
