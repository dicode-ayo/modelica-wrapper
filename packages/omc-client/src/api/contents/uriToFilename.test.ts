/**
 * Unit tests for the `uriToFilename` wrapper's response parsing — no OMC
 * contact. The integration test (`test/omedit-utilities.integration.test.ts`)
 * resolves real URIs; these pin the string decoding and the command string
 * (the String arg is quoted, see audit.md §2.10).
 */

import { describe, expect, it, vi } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { uriToFilename } from "./uriToFilename.js";

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

describe("uriToFilename parsing", () => {
  it("decodes a resolved absolute path", async () => {
    const { ctx } = fakeCtx(
      '"/home/u/.openmodelica/libraries/Modelica/package.mo"',
    );
    const out = await uriToFilename(ctx, {
      uri: "modelica://Modelica/package.mo",
    });
    expect(out).toEqual({
      filename: "/home/u/.openmodelica/libraries/Modelica/package.mo",
    });
  });

  it("falls back to an empty string when OMC returns the empty default", async () => {
    const { ctx } = fakeCtx('""');
    const out = await uriToFilename(ctx, { uri: "modelica://Nope/x.png" });
    expect(out).toEqual({ filename: "" });
  });

  it("falls back to empty string when OMC returns its null sentinel", async () => {
    const { ctx } = fakeCtx("-");
    const out = await uriToFilename(ctx, { uri: "modelica://Nope/x.png" });
    expect(out).toEqual({ filename: "" });
  });

  it("quotes the URI argument in the command (audit §2.10)", async () => {
    const { ctx, call } = fakeCtx('""');
    await uriToFilename(ctx, { uri: "modelica://Modelica/package.mo" });
    expect(call).toHaveBeenCalledWith(
      'uriToFilename("modelica://Modelica/package.mo")',
    );
  });

  it("throws when OMC returns a non-string (drift detection)", async () => {
    // OMC always returns a string, but if the response shape drifts
    // (e.g. a boolean `false` on error) the parse should throw rather
    // than silently returning an empty filename.
    const { ctx } = fakeCtx("false");
    await expect(
      uriToFilename(ctx, { uri: "modelica://Nope/x.png" }),
    ).rejects.toThrow();
  });
});
