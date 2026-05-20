/**
 * Unit tests for the `getDerivedUnits` wrapper's response parsing — no OMC
 * contact. The integration test (`test/omedit-utilities.integration.test.ts`)
 * exercises live values; these pin the list decoding and the command string
 * (the String arg is quoted, see audit.md §2.10).
 */

import { describe, expect, it, vi } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { getDerivedUnits } from "./getDerivedUnits.js";

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

describe("getDerivedUnits parsing", () => {
  it("decodes a non-empty list of derived units", async () => {
    const { ctx } = fakeCtx('{"degC", "degF", "degRk"}');
    const out = await getDerivedUnits(ctx, { baseUnit: "K" });
    expect(out).toEqual({ derivedUnits: ["degC", "degF", "degRk"] });
  });

  it("decodes the empty-list case", async () => {
    const { ctx } = fakeCtx("{}");
    const out = await getDerivedUnits(ctx, { baseUnit: "1" });
    expect(out).toEqual({ derivedUnits: [] });
  });

  it("quotes the String argument in the command (audit §2.10)", async () => {
    const { ctx, call } = fakeCtx("{}");
    await getDerivedUnits(ctx, { baseUnit: "K" });
    expect(call).toHaveBeenCalledWith('getDerivedUnits("K")');
  });
});
