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

describe("val: OMC error replies (#658)", () => {
  it("parses a clean value", async () => {
    const out = await val(stubCtx("1.5"), { var: "x" });
    expect(out).toEqual({ valAtTime: 1.5 });
  });

  it("surfaces OMC's own diagnostic rather than 'expected float, got ident'", async () => {
    // OMC answers with the bare word `Error` in place of a number — asking
    // for a variable that doesn't exist, or a time outside the simulation.
    // `parse()` accepts it cleanly as a one-word ident, so the mismatch used
    // to surface as a type-mismatch complaint that named the wrong culprit.
    await expect(
      val(stubCtx("Error"), { var: "no.such.variable" }),
    ).rejects.toThrow(OmcDiagnosticError);
    await expect(
      val(stubCtx("Error"), { var: "no.such.variable" }),
    ).rejects.toThrow("Error");
  });
});
