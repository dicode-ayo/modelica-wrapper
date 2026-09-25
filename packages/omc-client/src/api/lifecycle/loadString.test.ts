import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { OmcDiagnosticError } from "../../error-buffer.js";

import { loadString } from "./loadString.js";

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

describe("loadString: OMC error replies", () => {
  it("parses a clean success", async () => {
    const out = await loadString(stubCtx("true"), { data: "model M end M;" });
    expect(out).toEqual({ success: true });
  });

  it("surfaces OMC's own diagnostic rather than a trailing-input parse complaint", async () => {
    // `loadString` answers `false` and then OMC's diagnostic line.
    const raw = "false\nError occurred building AST";
    await expect(
      loadString(stubCtx(raw), { data: "model 'bad name' end 'bad name';" }),
    ).rejects.toThrow(new OmcDiagnosticError(raw));
  });
});
