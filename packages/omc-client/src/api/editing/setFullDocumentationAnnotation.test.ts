/**
 * Wrapper-level tests for `setFullDocumentationAnnotation`.
 *
 * Uses a stub `CallContext` — this is a unit test of command formatting, not
 * of the OMC API itself.
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";

import { setFullDocumentationAnnotation } from "./setFullDocumentationAnnotation.js";

interface StubLog {
  sent: string[];
}

function stubCtx(response: string): { ctx: CallContext; log: StubLog } {
  const log: StubLog = { sent: [] };
  const ctx: CallContext = {
    async call(cmd) {
      log.sent.push(cmd);
      return response;
    },
    async getErrorString() {
      return { errorString: "" };
    },
  };
  return { ctx, log };
}

describe("setFullDocumentationAnnotation: outgoing command shape", () => {
  it("composes info, revisions, and infoHeader into one addClassAnnotation call", async () => {
    const { ctx, log } = stubCtx("true");
    await setFullDocumentationAnnotation(ctx, {
      typeName: "MyPkg.MyModel",
      info: "<html><p>New info</p></html>",
      revisions: "<html><p>v1</p></html>",
      infoHeader: "<html><p>header</p></html>",
    });
    expect(log.sent).toEqual([
      'addClassAnnotation(MyPkg.MyModel, Documentation(info="<html><p>New info</p></html>", ' +
        'revisions="<html><p>v1</p></html>", __OpenModelica_infoHeader="<html><p>header</p></html>"))',
    ]);
  });

  it("defaults every section to an empty string when omitted", async () => {
    const { ctx, log } = stubCtx("true");
    await setFullDocumentationAnnotation(ctx, { typeName: "MyPkg.MyModel" });
    expect(log.sent).toEqual([
      'addClassAnnotation(MyPkg.MyModel, Documentation(info="", revisions="", __OpenModelica_infoHeader=""))',
    ]);
  });

  it("escapes quotes and newlines in each section", async () => {
    const { ctx, log } = stubCtx("true");
    await setFullDocumentationAnnotation(ctx, {
      typeName: "MyPkg.MyModel",
      info: 'a "quoted" line\nsecond line',
      infoHeader: "",
    });
    expect(log.sent).toEqual([
      'addClassAnnotation(MyPkg.MyModel, Documentation(info="a \\"quoted\\" line\\nsecond line", ' +
        'revisions="", __OpenModelica_infoHeader=""))',
    ]);
  });
});

describe("setFullDocumentationAnnotation: response parsing", () => {
  it("returns success=true on a clean true response", async () => {
    const { ctx } = stubCtx("true");
    const out = await setFullDocumentationAnnotation(ctx, {
      typeName: "MyPkg.MyModel",
    });
    expect(out).toEqual({ success: true });
  });

  it("returns success=false on a clean false response", async () => {
    const { ctx } = stubCtx("false");
    const out = await setFullDocumentationAnnotation(ctx, {
      typeName: "MyPkg.MyModel",
    });
    expect(out).toEqual({ success: false });
  });
});
