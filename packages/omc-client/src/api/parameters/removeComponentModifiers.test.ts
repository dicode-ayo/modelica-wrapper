/**
 * `removeComponentModifiers` is one of the OMC mutations that answers with an
 * empty response on success (see `_shared/parseOutput.ts`); success is
 * decided by the error buffer, not the response body.
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";

import { removeComponentModifiers } from "./removeComponentModifiers.js";

function stubCtx(
  response: string,
  errorString = "",
): { ctx: CallContext; sent: string[] } {
  const sent: string[] = [];
  const ctx: CallContext = {
    async call(cmd) {
      sent.push(cmd);
      return response;
    },
    async getErrorString() {
      return { errorString };
    },
  };
  return { ctx, sent };
}

describe("removeComponentModifiers: response parsing", () => {
  it("reports success when OMC answers with an empty response", async () => {
    const { ctx } = stubCtx("");
    const out = await removeComponentModifiers(ctx, {
      typeName: "MyPkg.M",
      componentName: "gain",
    });
    expect(out).toEqual({ success: true });
  });

  it("surfaces the error buffer when an empty response hides a failure", async () => {
    const { ctx } = stubCtx("", "Class MyPkg.M not found");
    await expect(
      removeComponentModifiers(ctx, {
        typeName: "MyPkg.M",
        componentName: "gain",
      }),
    ).rejects.toThrow("removeComponentModifiers: Class MyPkg.M not found");
  });

  it("takes OMC's own verdict when it answers with a bool", async () => {
    const { ctx } = stubCtx("true");
    const out = await removeComponentModifiers(ctx, {
      typeName: "MyPkg.M",
      componentName: "gain",
    });
    expect(out).toEqual({ success: true });

    const falsey = stubCtx("false");
    const failed = await removeComponentModifiers(falsey.ctx, {
      typeName: "MyPkg.M",
      componentName: "gain",
    });
    expect(failed).toEqual({ success: false });
  });

  it("quotes componentName — OMC types it as String, not TypeName", async () => {
    const { ctx, sent } = stubCtx("");
    await removeComponentModifiers(ctx, {
      typeName: "MyPkg.M",
      componentName: "gain",
      keepRedeclares: true,
    });
    expect(sent).toEqual(['removeComponentModifiers(MyPkg.M, "gain", true)']);
  });
});
