/**
 * Wrapper-level tests for `getModelInstance`.
 *
 * Uses a stub `CallContext` — this is a unit test of command formatting +
 * response unwrapping, not of the OMC API itself (that lives in
 * test/integration.test.ts).
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { ModelInstanceNotFullyLoadedError } from "../../_shared/modelInstance.js";
import { quote } from "../../_shared/format.js";

import { getModelInstance } from "./getModelInstance.js";

function stubCtx(response?: string): { ctx: CallContext } {
  const json = JSON.stringify({
    name: "Modelica.Blocks.Math.Sin",
    restriction: "block",
  });
  const ctx: CallContext = {
    async call() {
      return response ?? quote(json);
    },
    async getErrorString() {
      return { errorString: "" };
    },
  };
  return { ctx };
}

describe("getModelInstance: response handling", () => {
  it("unwraps the Modelica-string-wrapped JSON into a parsed instance", async () => {
    const { ctx } = stubCtx();
    const out = await getModelInstance(ctx, {
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(out.instance.name).toBe("Modelica.Blocks.Math.Sin");
    expect(out.instance.restriction).toBe("block");
  });

  it("throws ModelInstanceNotFullyLoadedError when name is null (partial-load shape)", async () => {
    const { ctx } = stubCtx(
      quote(JSON.stringify({ name: null, restriction: null })),
    );

    await expect(
      getModelInstance(ctx, { typeName: "Some.Child" }),
    ).rejects.toThrow(ModelInstanceNotFullyLoadedError);
    await expect(
      getModelInstance(ctx, { typeName: "Some.Child" }),
    ).rejects.toThrow(/Some\.Child.*not fully loaded/);
  });

  it("throws ModelInstanceNotFullyLoadedError when name is missing entirely", async () => {
    const { ctx } = stubCtx(quote(JSON.stringify({ restriction: "model" })));

    await expect(
      getModelInstance(ctx, { typeName: "Some.Child" }),
    ).rejects.toThrow(ModelInstanceNotFullyLoadedError);
  });

  it("still throws the generic shape-mismatch error for an unrelated malformed field", async () => {
    const { ctx } = stubCtx(
      quote(
        JSON.stringify({
          name: "Some.Class",
          restriction: "model",
          elements: "not-an-array",
        }),
      ),
    );

    await expect(
      getModelInstance(ctx, { typeName: "Some.Class" }),
    ).rejects.toThrow(/OMC response shape mismatch for getModelInstance/);
  });
});
