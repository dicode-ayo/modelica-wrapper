import { describe, expect, it, vi } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { OmcDiagnosticError } from "../../diagnostic-error.js";
import { REGISTRY } from "../../registry.js";
import { evaluateConstant } from "./evaluateConstant.js";

function fakeCtx(
  response: string,
  errorString = "",
): {
  ctx: CallContext;
  call: ReturnType<typeof vi.fn>;
  getErrorString: ReturnType<typeof vi.fn>;
} {
  const call = vi.fn(async () => response);
  const getErrorString = vi.fn(async () => ({ errorString }));
  const ctx: CallContext = {
    call: call as unknown as CallContext["call"],
    getErrorString,
  };
  return { ctx, call, getErrorString };
}

describe("evaluateConstant", () => {
  it("sends the bare reference as the whole command", async () => {
    const { ctx, call } = fakeCtx("1e-15\n");
    await evaluateConstant(ctx, { name: "Modelica.Constants.eps" });
    expect(call).toHaveBeenCalledWith("Modelica.Constants.eps");
  });

  it.each([
    ["1e-15\n", 1e-15],
    ["2147483647", 2147483647],
    ["true", true],
    ['"m/s"', "m/s"],
  ])("reads a scalar literal reply %j", async (reply, value) => {
    const { ctx, getErrorString } = fakeCtx(reply);
    expect(
      await evaluateConstant(ctx, { name: "Modelica.Constants.eps" }),
    ).toEqual({ value });
    expect(getErrorString).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty reply", ""],
    ["an echoed or enumeration name", "Modelica.Blocks.Types.Init.NoInit"],
    ["a record", "Complex(re = 1.0, im = 0.0)"],
    ["an array", "{1.0, 2.0}"],
  ])("fails on %s and drains the diagnostic it left", async (_label, reply) => {
    const { ctx, getErrorString } = fakeCtx(
      reply,
      "Error: Variable Foo.bar not found in scope <interactive>.\n",
    );
    await expect(
      evaluateConstant(ctx, { name: "Foo.bar" }),
    ).rejects.toBeInstanceOf(OmcDiagnosticError);
    expect(getErrorString).toHaveBeenCalledTimes(1);
  });

  it.each([
    "eps",
    "Modelica.Constants.eps[1]",
    "Modelica.'Constants'.eps",
    "Modelica.Constants.eps; deleteClass(Modelica)",
    "Modelica..eps",
  ])("refuses %j at the schema, before it reaches OMC", (name) => {
    expect(
      REGISTRY.evaluateConstant.inputSchema.safeParse({ name }).success,
    ).toBe(false);
  });
});
