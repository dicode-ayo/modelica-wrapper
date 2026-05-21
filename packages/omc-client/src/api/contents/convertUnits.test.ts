/**
 * Unit tests for the `convertUnits` wrapper's response parsing — no OMC
 * contact. The integration test (`test/convertUnits.integration.test.ts`)
 * exercises the live values; these pin the tuple decoding and the command
 * string (String args quoted, see audit.md §2.10).
 */

import { describe, expect, it, vi } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { convertUnits } from "./convertUnits.js";

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

describe("convertUnits parsing", () => {
  it("decodes a compatible (true, scale, offset) tuple", async () => {
    const { ctx } = fakeCtx("(true, 0.017453292519943295, 0.0)");
    const out = await convertUnits(ctx, { s1: "rad", s2: "deg" });
    expect(out).toEqual({
      unitsCompatible: true,
      scaleFactor: 0.017453292519943295,
      offset: 0,
    });
  });

  it("decodes a non-zero offset (degC → K)", async () => {
    const { ctx } = fakeCtx("(true, 1.0, -273.15)");
    const out = await convertUnits(ctx, { s1: "degC", s2: "K" });
    expect(out.unitsCompatible).toBe(true);
    expect(out.scaleFactor).toBe(1);
    expect(out.offset).toBeCloseTo(-273.15, 6);
  });

  it("decodes an incompatible verdict with neutral scale/offset", async () => {
    const { ctx } = fakeCtx("(false, 1.0, 0.0)");
    const out = await convertUnits(ctx, { s1: "m", s2: "kg" });
    expect(out).toEqual({
      unitsCompatible: false,
      scaleFactor: 1,
      offset: 0,
    });
  });

  it("quotes both String arguments in the command (audit §2.10)", async () => {
    const { ctx, call } = fakeCtx("(true, 1.0, 0.0)");
    await convertUnits(ctx, { s1: "rad", s2: "deg" });
    expect(call).toHaveBeenCalledWith('convertUnits("rad", "deg")');
  });

  // ── Off-spec responses → neutral defaults, never throw (issue #76, item 12)
  it("falls back to neutral defaults on a non-tuple (error prose) response", async () => {
    const { ctx } = fakeCtx("Error: convertUnits failed");
    const out = await convertUnits(ctx, { s1: "rad", s2: "deg" });
    expect(out).toEqual({ unitsCompatible: false, scaleFactor: 1, offset: 0 });
  });

  it("tolerates a trailing diagnostic line after the tuple", async () => {
    const { ctx } = fakeCtx("(true, 2.0, 0.0)\nWarning: deprecated unit");
    const out = await convertUnits(ctx, { s1: "rad", s2: "deg" });
    expect(out).toEqual({ unitsCompatible: true, scaleFactor: 2, offset: 0 });
  });

  it("falls back when OMC returns an empty response", async () => {
    const { ctx } = fakeCtx("");
    const out = await convertUnits(ctx, { s1: "rad", s2: "deg" });
    expect(out).toEqual({ unitsCompatible: false, scaleFactor: 1, offset: 0 });
  });

  it("fills missing tuple fields with neutral defaults (short tuple)", async () => {
    const { ctx } = fakeCtx("(true)");
    const out = await convertUnits(ctx, { s1: "rad", s2: "deg" });
    expect(out).toEqual({ unitsCompatible: true, scaleFactor: 1, offset: 0 });
  });
});
