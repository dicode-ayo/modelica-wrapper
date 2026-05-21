/**
 * Wrapper-level tests for `updateConnection` (issue #76, item 13).
 *
 * The mutator previously used a bare `expectBool(parse(raw))`, so a
 * `false` (or off-spec failure prose) carried no diagnostic and was
 * indistinguishable from a clean success at the call site. It now routes
 * through `parseMutationDiagnostic`, matching the `addComponent` shape.
 *
 * Uses a stub `CallContext` rather than a real OMC.
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";

import { updateConnection } from "./updateConnection.js";

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

describe("updateConnection: response parsing", () => {
  it("returns success=true on a clean true response", async () => {
    const { ctx } = stubCtx("true");
    const out = await updateConnection(ctx, {
      typeName: "MyPkg.M",
      from: "a.p",
      to: "b.n",
      annotation: "Line(points={{0,0},{10,10}})",
    });
    expect(out).toEqual({ success: true });
  });

  it("returns success=false on a plain false response", async () => {
    const { ctx } = stubCtx("false");
    const out = await updateConnection(ctx, {
      typeName: "MyPkg.M",
      from: "a.p",
      to: "b.n",
      annotation: "Line()",
    });
    expect(out).toEqual({ success: false });
  });

  it("captures the trailing diagnostic when OMC appends a failure line", async () => {
    const { ctx } = stubCtx("false\nError: connection not found");
    const out = await updateConnection(ctx, {
      typeName: "MyPkg.M",
      from: "a.p",
      to: "b.n",
      annotation: "Line()",
    });
    expect(out).toEqual({
      success: false,
      diagnostic: "Error: connection not found",
    });
  });

  it("treats a non-bool leading value as failure and surfaces the raw prose", async () => {
    const { ctx } = stubCtx("Error: lookup failed");
    const out = await updateConnection(ctx, {
      typeName: "MyPkg.M",
      from: "a.p",
      to: "b.n",
      annotation: "Line()",
    });
    expect(out).toEqual({
      success: false,
      diagnostic: "Error: lookup failed",
    });
  });
});

describe("updateConnection: outgoing command shape", () => {
  it("quotes from/to and puts className first", async () => {
    const { ctx, sent } = stubCtx("true");
    await updateConnection(ctx, {
      typeName: "MyPkg.M",
      from: "a.p",
      to: "b.n",
      annotation: "Line(points={{0,0}})",
    });
    expect(sent).toEqual([
      'updateConnection(MyPkg.M, "a.p", "b.n", Line(points={{0,0}}))',
    ]);
  });
});
