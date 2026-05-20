/**
 * Unit tests for the `qualifyPath` wrapper's response parsing — no OMC
 * contact. The integration test (`test/omedit-utilities.integration.test.ts`)
 * exercises a live qualification; these pin the TypeName decoding and the
 * command string (both TypeName args emitted bare, see audit.md §2.6).
 */

import { describe, expect, it, vi } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { qualifyPath } from "./qualifyPath.js";

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

describe("qualifyPath parsing", () => {
  it("decodes the fully qualified TypeName", async () => {
    const { ctx } = fakeCtx("Modelica.Electrical.Analog.Basic.Resistor");
    const out = await qualifyPath(ctx, {
      typeName: "Modelica.Electrical.Analog.Basic",
      path: "Resistor",
    });
    expect(out).toEqual({
      qualifiedPath: "Modelica.Electrical.Analog.Basic.Resistor",
    });
  });

  it("emits both TypeName arguments bare (audit §2.6)", async () => {
    const { ctx, call } = fakeCtx("Modelica.Electrical.Analog.Basic.Resistor");
    await qualifyPath(ctx, {
      typeName: "Modelica.Electrical.Analog.Basic",
      path: "Resistor",
    });
    expect(call).toHaveBeenCalledWith(
      "qualifyPath(Modelica.Electrical.Analog.Basic, Resistor)",
    );
  });
});
