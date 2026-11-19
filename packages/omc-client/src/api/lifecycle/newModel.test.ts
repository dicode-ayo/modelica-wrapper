/**
 * OMC's `newModel` answers `true` over a model that already exists and
 * replaces it with an empty one, so the wrapper must refuse first.
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";

import { newModel } from "./newModel.js";

function stubCtx(existClassReply: string | Error): {
  ctx: CallContext;
  sent: string[];
} {
  const sent: string[] = [];
  const ctx: CallContext = {
    async call(cmd) {
      sent.push(cmd);
      if (cmd.startsWith("existClass(")) {
        if (existClassReply instanceof Error) throw existClassReply;
        return existClassReply;
      }
      return "true";
    },
    async getErrorString() {
      return { errorString: "" };
    },
  };
  return { ctx, sent };
}

describe("newModel", () => {
  it("refuses a model that already exists in withinPath", async () => {
    const { ctx, sent } = stubCtx("true");
    const out = await newModel(ctx, { typeName: "M", withinPath: "P" });
    expect(out).toEqual({
      success: false,
      diagnostic:
        "P.M already exists — creating it again would replace it with an empty model",
    });
    expect(sent).toEqual(["existClass(P.M)"]);
  });

  it("creates a model that does not exist yet", async () => {
    const { ctx, sent } = stubCtx("false");
    const out = await newModel(ctx, { typeName: "M", withinPath: "P" });
    expect(out).toEqual({ success: true });
    expect(sent).toEqual(["existClass(P.M)", "newModel(M, P)"]);
  });

  it("refuses rather than creating when the existence check fails", async () => {
    const { ctx, sent } = stubCtx(new Error("transport closed"));
    const out = await newModel(ctx, { typeName: "M", withinPath: "P" });
    expect(out).toEqual({
      success: false,
      diagnostic: "could not verify the write is safe: transport closed",
    });
    expect(sent).not.toContain("newModel(M, P)");
  });
});
