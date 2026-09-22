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
 *   - the pre-write screen refuses an unresolvable `componentClass` or a
 *     duplicate `componentName` without ever calling OMC's `addComponent`
 *   - the screen resolves `componentClass` within `intoTypeName`'s scope
 *     before checking it exists, so a relative name that's only valid in
 *     that scope is allowed through rather than falsely refused
 *   - a screening call that throws yields `{ success: false, diagnostic }`
 *     instead of propagating
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
 * Build a CallContext whose `call()` routes `qualifyPath`/`existClass`/
 * `getComponents` screening calls and otherwise returns `response` (the
 * `addComponent` reply). `classExists`/`existingNames` drive the last two
 * screens; both default to letting the write through, so callers that only
 * care about the final `addComponent` response don't need to pass `opts`.
 * `qualifiedPath`, when set, is returned verbatim for any `qualifyPath(...)`
 * call; when unset, the stub echoes back the `path` argument unchanged,
 * parsed out of the `` `qualifyPath(${typeName}, ${path})` `` command (safe
 * to split on `", "` since neither argument contains a comma per the
 * `modelicaName` grammar). `getErrorString()` returns an empty buffer. The
 * `log` captures what the wrapper sent so individual tests can assert the
 * command shape without re-coupling to the implementation.
 */
function stubCtx(
  response: string,
  opts?: {
    classExists?: boolean;
    existingNames?: string[];
    qualifiedPath?: string;
  },
): { ctx: CallContext; log: StubLog } {
  const classExists = opts?.classExists ?? true;
  const existingNames = opts?.existingNames ?? [];
  const log: StubLog = { sent: [], errorStringCalls: 0 };
  const ctx: CallContext = {
    async call(cmd) {
      log.sent.push(cmd);
      if (cmd.startsWith("qualifyPath(")) {
        if (opts?.qualifiedPath !== undefined) return opts.qualifiedPath;
        const inner = cmd.slice("qualifyPath(".length, -1);
        const path = inner.split(", ").at(1);
        if (path === undefined) {
          throw new Error(`stub could not parse qualifyPath command: ${cmd}`);
        }
        return path;
      }
      if (cmd.startsWith("existClass(")) return String(classExists);
      if (cmd.startsWith("getComponents(")) {
        if (existingNames.length === 0) return "{}";
        const rows = existingNames.map(
          (n) =>
            `{"Real","${n}","","public",false,false,false,false,"","","",{}}`,
        );
        return `{${rows.join(",")}}`;
      }
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
      "qualifyPath(MyPkg.MyModel, Real)",
      "existClass(Real)",
      "getComponents(MyPkg.MyModel, useQuotes=false)",
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
    expect(log.sent.at(-1)).toEqual(
      "addComponent(gain1, Modelica.Blocks.Math.Gain, MyPkg.MyModel, " +
        "annotate=Placement(visible=true, transformation(origin={10, 20}, extent={{-10, -10}, {10, 10}})))",
    );
  });
});

describe("addComponent: pre-write screen", () => {
  it("refuses without calling OMC's addComponent when componentClass does not resolve", async () => {
    const { ctx, log } = stubCtx("true", { classExists: false });
    const out = await addComponent(ctx, {
      componentName: "gain1",
      componentClass: "Not.A.Real.Class",
      intoTypeName: "MyPkg.MyModel",
    });
    expect(out).toEqual({
      success: false,
      diagnostic: "Not.A.Real.Class does not resolve to a known class",
    });
    expect(log.sent.some((cmd) => cmd.startsWith("addComponent("))).toBe(false);
  });

  it("refuses without calling OMC's addComponent when componentName already exists in intoTypeName", async () => {
    const { ctx, log } = stubCtx("true", {
      classExists: true,
      existingNames: ["gain1"],
    });
    const out = await addComponent(ctx, {
      componentName: "gain1",
      componentClass: "Modelica.Blocks.Math.Gain",
      intoTypeName: "MyPkg.MyModel",
    });
    expect(out).toEqual({
      success: false,
      diagnostic: "MyPkg.MyModel already declares a component named gain1",
    });
    expect(log.sent.some((cmd) => cmd.startsWith("addComponent("))).toBe(false);
  });

  it("allows a componentClass that only resolves within intoTypeName's scope", async () => {
    // "Sibling.Gain" isn't a name existClass would recognize directly, but
    // qualifyPath resolves it in MyPkg.MyModel's scope to something that
    // does exist — the screen must check the qualified name, not the raw one.
    const { ctx, log } = stubCtx("true", {
      classExists: true,
      qualifiedPath: "MyPkg.Sibling.Gain",
    });
    const out = await addComponent(ctx, {
      componentName: "gain1",
      componentClass: "Sibling.Gain",
      intoTypeName: "MyPkg.MyModel",
    });
    expect(out).toEqual({ success: true });
    expect(log.sent).toEqual([
      "qualifyPath(MyPkg.MyModel, Sibling.Gain)",
      "existClass(MyPkg.Sibling.Gain)",
      "getComponents(MyPkg.MyModel, useQuotes=false)",
      "addComponent(gain1, Sibling.Gain, MyPkg.MyModel, annotate=Placement())",
    ]);
  });

  it("returns a diagnostic instead of throwing when a screening call fails", async () => {
    const ctx: CallContext = {
      async call(cmd) {
        if (cmd.startsWith("qualifyPath(")) return "Real";
        if (cmd.startsWith("existClass(")) return "true";
        if (cmd.startsWith("getComponents(")) {
          throw new Error("class MyPkg.DoesNotExist not found");
        }
        return "true";
      },
      async getErrorString() {
        return { errorString: "" };
      },
    };
    const out = await addComponent(ctx, {
      componentName: "x",
      componentClass: "Real",
      intoTypeName: "MyPkg.DoesNotExist",
    });
    expect(out).toEqual({
      success: false,
      diagnostic:
        "could not verify the write is safe: class MyPkg.DoesNotExist not found",
    });
  });
});
