import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { OmcDiagnosticError } from "../../error-buffer.js";

import { val } from "./val.js";

function stubCtx(response: string): CallContext {
  return {
    async call() {
      return response;
    },
    async getErrorString() {
      return { errorString: "" };
    },
  };
}

describe("val: OMC error replies", () => {
  it("parses a clean value", async () => {
    const out = await val(stubCtx("1.5"), { var: "x" });
    expect(out).toEqual({ valAtTime: 1.5 });
  });

  it("surfaces OMC's own diagnostic rather than 'expected float, got ident'", async () => {
    // OMC answers with the bare word `Error` in place of a number — asking
    // for a variable that doesn't exist, or a time outside the simulation.
    // `parse()` accepts it cleanly as a one-word ident, so the mismatch has
    // to be caught where the float is expected.
    await expect(
      val(stubCtx("Error"), { var: "no.such.variable" }),
    ).rejects.toThrow(new OmcDiagnosticError("Error"));
  });
});
