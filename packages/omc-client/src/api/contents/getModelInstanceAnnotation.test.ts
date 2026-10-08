/**
 * Wrapper-level tests for `getModelInstanceAnnotation`.
 *
 * Focus is the outgoing OMC command shape — specifically the
 * `filter` (`String[:]`) and `prettyPrint` args added in #25 so the
 * extension can do OMEdit's cheap icon-only fetch:
 *
 *   - empty filter  → `fill("", 0)`  (NOT `{}` — OMC's interactive
 *     parser rejects the bare empty-brace literal for a `String[:]`
 *     and reports the misleading "Class ... not found in scope";
 *     see docs/audit.md §2.10)
 *   - non-empty      → `{"Icon", "IconMap", ...}` (quoted, comma-joined)
 *   - prettyPrint    → `true` / `false`
 *
 * Uses a stub `CallContext` — this is a unit test of command
 * formatting + response unwrapping, not of the OMC API itself (that
 * lives in test/integration.test.ts).
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { ModelInstanceNotFullyLoadedError } from "../../_shared/modelInstance.js";

import { getModelInstanceAnnotation } from "./getModelInstanceAnnotation.js";

interface StubLog {
  sent: string[];
}

/**
 * A CallContext whose `call()` returns a fixed OMC response and records
 * the command it was asked to send. The default response is a minimal
 * valid `ModelInstance` JSON tree wrapped in a Modelica string literal,
 * exactly as OMC returns it.
 */
function stubCtx(response?: string): { ctx: CallContext; log: StubLog } {
  const log: StubLog = { sent: [] };
  const json = JSON.stringify({
    name: "Modelica.Blocks.Math.Sin",
    restriction: "block",
  });
  const ctx: CallContext = {
    async call(cmd) {
      log.sent.push(cmd);
      return response ?? quote(json);
    },
    async getErrorString() {
      return { errorString: "" };
    },
  };
  return { ctx, log };
}

describe("getModelInstanceAnnotation: outgoing command shape", () => {
  it('emits fill("", 0) for the empty (default) filter', async () => {
    const { ctx, log } = stubCtx();
    await getModelInstanceAnnotation(ctx, {
      typeName: "Modelica.Blocks.Math.Sin",
    });
    expect(log.sent).toEqual([
      'getModelInstanceAnnotation(Modelica.Blocks.Math.Sin, fill("", 0), false)',
    ]);
  });

  it('emits fill("", 0) when filter is explicitly empty', async () => {
    const { ctx, log } = stubCtx();
    await getModelInstanceAnnotation(ctx, {
      typeName: "Modelica.Blocks.Math.Sin",
      filter: [],
    });
    expect(log.sent[0]).toContain('fill("", 0)');
    expect(log.sent[0]).not.toContain("{}");
  });

  it("quotes and comma-joins a non-empty filter (OMEdit's icon set)", async () => {
    const { ctx, log } = stubCtx();
    await getModelInstanceAnnotation(ctx, {
      typeName: "Modelica.Blocks.Math.Sin",
      filter: ["Icon", "IconMap", "Diagram", "DiagramMap", "experiment"],
    });
    expect(log.sent).toEqual([
      "getModelInstanceAnnotation(Modelica.Blocks.Math.Sin, " +
        '{"Icon", "IconMap", "Diagram", "DiagramMap", "experiment"}, false)',
    ]);
  });

  it("passes prettyPrint=true through to the command", async () => {
    const { ctx, log } = stubCtx();
    await getModelInstanceAnnotation(ctx, {
      typeName: "Modelica.Blocks.Math.Sin",
      filter: ["Icon"],
      prettyPrint: true,
    });
    expect(log.sent).toEqual([
      'getModelInstanceAnnotation(Modelica.Blocks.Math.Sin, {"Icon"}, true)',
    ]);
  });

  it("emits the className bare (no quoting)", async () => {
    const { ctx, log } = stubCtx();
    await getModelInstanceAnnotation(ctx, {
      typeName: "Modelica.Blocks.Examples.PID_Controller",
    });
    expect(log.sent[0]).toContain(
      "getModelInstanceAnnotation(Modelica.Blocks.Examples.PID_Controller, ",
    );
  });
});

describe("getModelInstanceAnnotation: response handling", () => {
  it("unwraps the Modelica-string-wrapped JSON into a parsed instance", async () => {
    const { ctx } = stubCtx();
    const out = await getModelInstanceAnnotation(ctx, {
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
      getModelInstanceAnnotation(ctx, { typeName: "Some.Child" }),
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
      getModelInstanceAnnotation(ctx, { typeName: "Some.Class" }),
    ).rejects.toThrow(
      /OMC response shape mismatch for getModelInstanceAnnotation/,
    );
  });
});
