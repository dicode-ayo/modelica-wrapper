/**
 * Unit tests for the `loadClassContentString` wrapper's response parsing — no
 * OMC contact. The integration test (`test/omedit-utilities.integration.test.ts`)
 * exercises a live insert; these pin the Boolean decoding and the command
 * string (the `data` String arg is quoted, the `className` TypeName is bare,
 * and the Integer offsets are positional — see audit.md §2.6 / §2.10).
 */

import { describe, expect, it, vi } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { loadClassContentString } from "./loadClassContentString.js";

function fakeCtx(response: string): {
  ctx: CallContext;
  call: ReturnType<typeof vi.fn>;
} {
  const call = vi.fn(async () => response);
  const ctx: CallContext = {
    call: call as unknown as CallContext["call"],
    getErrorString: async () => ({ errorString: "" }),
  };
  return { ctx, call };
}

describe("loadClassContentString parsing", () => {
  it("decodes the success Boolean", async () => {
    const { ctx } = fakeCtx("true");
    const out = await loadClassContentString(ctx, {
      data: "Real y;",
      typeName: "PasteTarget",
    });
    expect(out).toEqual({ success: true });
  });

  it("defaults both offsets to 0 and quotes data, leaves className bare", async () => {
    const { ctx, call } = fakeCtx("true");
    await loadClassContentString(ctx, {
      data: "Real y;",
      typeName: "PasteTarget",
    });
    expect(call).toHaveBeenCalledWith(
      'loadClassContentString("Real y;", PasteTarget, 0, 0)',
    );
  });

  it("forwards explicit (offsetX, offsetY) positionally", async () => {
    const { ctx, call } = fakeCtx("true");
    await loadClassContentString(ctx, {
      data: "Real y;",
      typeName: "PasteTarget",
      offsetX: 50,
      offsetY: -20,
    });
    expect(call).toHaveBeenCalledWith(
      'loadClassContentString("Real y;", PasteTarget, 50, -20)',
    );
  });
});
