/**
 * Wrapper-level tests for `addComponent`.
 *
 * Covers:
 *   - clean success (`"true"`) → `{ success: true }`, no diagnostic
 *   - clean failure (`"false"`) → `{ success: false }`, no diagnostic
 *   - failure with OMC's trailing diagnostic (the regression that
 *     used to crash strict `parse()` with "unexpected trailing input")
 *   - the OMC `call(...)` command is shaped correctly: includes the
 *     placement annotation with the `annotate=` prefix
 *
 * Uses a stub `CallContext` rather than spinning a real OMC — this
 * is a unit test for the wrapper's response handling, not an
 * integration test of the OMC API itself.
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";

import { addComponent } from "./addComponent.js";

interface StubLog {
  sent: string[];
  errorStringCalls: number;
}

/**
 * Build a CallContext whose `call()` always returns `response` and
 * `getErrorString()` returns an empty buffer. The `log` captures
 * what the wrapper sent so individual tests can assert the command
 * shape without re-coupling to the implementation.
 */
function stubCtx(response: string): { ctx: CallContext; log: StubLog } {
  const log: StubLog = { sent: [], errorStringCalls: 0 };
  const ctx: CallContext = {
    async call(cmd) {
      log.sent.push(cmd);
      return response;
    },
    async getErrorString() {
      log.errorStringCalls += 1;
      return { errorString: "" };
    },
  };
  return { ctx, log };
}

describe("addComponent: response parsing", () => {
  it("returns success=true and omits diagnostic on a clean true response", async () => {
    const { ctx } = stubCtx("true");
    const out = await addComponent(ctx, {
      componentName: "gain1",
      componentClass: "Modelica.Blocks.Math.Gain",
      intoTypeName: "MyPkg.MyModel",
    });
    expect(out).toEqual({ success: true });
  });

  it("returns success=false with no diagnostic when OMC returns plain false", async () => {
    const { ctx } = stubCtx("false");
    const out = await addComponent(ctx, {
      componentName: "gain1",
      componentClass: "Modelica.Blocks.Math.Gain",
      intoTypeName: "MyPkg.MyModel",
    });
    expect(out).toEqual({ success: false });
  });

  it("captures the trailing diagnostic when OMC appends a failure line", async () => {
    // Regression test for the LimPID failure: OMC returned the bool
    // followed by an "Error occurred building AST" line, which
    // strict-parse rejected as unexpected trailing input. The
    // tolerant parser now captures it as `diagnostic`.
    const { ctx } = stubCtx("false\nError occurred building AST");
    const out = await addComponent(ctx, {
      componentName: "limPID1",
      componentClass: "Modelica.Blocks.Continuous.LimPID",
      intoTypeName: "MyPkg.MyModel",
    });
    expect(out).toEqual({
      success: false,
      diagnostic: "Error occurred building AST",
    });
  });

  it("ignores a lone trailing newline (no spurious diagnostic field)", async () => {
    const { ctx } = stubCtx("true\n");
    const out = await addComponent(ctx, {
      componentName: "gain1",
      componentClass: "Modelica.Blocks.Math.Gain",
      intoTypeName: "MyPkg.MyModel",
    });
    expect(out).toEqual({ success: true });
  });

  it("treats a non-bool leading value as a failure and captures the raw response", async () => {
    // Regression: OMC sometimes skips the bool entirely and returns a
    // bare error line (`Error: ...`). The leading token parses as an
    // ident, not a bool — without tolerance the wrapper used to throw
    // "expected bool, got ident".
    const { ctx } = stubCtx("Error: lookup failed");
    const out = await addComponent(ctx, {
      componentName: "filter1",
      componentClass: "Modelica.Blocks.Continuous.Filter",
      intoTypeName: "MyPkg.MyModel",
    });
    expect(out).toEqual({
      success: false,
      diagnostic: "Error: lookup failed",
    });
  });

  it("captures a multi-line non-bool response in the diagnostic", async () => {
    const raw =
      "Error: while adding Modelica.Blocks.Continuous.Filter\n" +
      "  reason: stack overflow expanding modifications";
    const { ctx } = stubCtx(raw);
    const out = await addComponent(ctx, {
      componentName: "filter1",
      componentClass: "Modelica.Blocks.Continuous.Filter",
      intoTypeName: "MyPkg.MyModel",
    });
    expect(out).toEqual({
      success: false,
      diagnostic: raw.trim(),
    });
  });
});

describe("addComponent: outgoing command shape", () => {
  it("formats the call with default placement when annotation is empty", async () => {
    const { ctx, log } = stubCtx("true");
    await addComponent(ctx, {
      componentName: "x",
      componentClass: "Real",
      intoTypeName: "MyPkg.MyModel",
    });
    expect(log.sent).toEqual([
      "addComponent(x, Real, MyPkg.MyModel, annotate=Placement())",
    ]);
  });

  it("prepends `annotate=` to the caller's Placement(...) annotation", async () => {
    const { ctx, log } = stubCtx("true");
    await addComponent(ctx, {
      componentName: "gain1",
      componentClass: "Modelica.Blocks.Math.Gain",
      intoTypeName: "MyPkg.MyModel",
      annotation:
        "Placement(visible=true, transformation(origin={10, 20}, extent={{-10, -10}, {10, 10}}))",
    });
    expect(log.sent).toEqual([
      "addComponent(gain1, Modelica.Blocks.Math.Gain, MyPkg.MyModel, " +
        "annotate=Placement(visible=true, transformation(origin={10, 20}, extent={{-10, -10}, {10, 10}})))",
    ]);
  });
});
