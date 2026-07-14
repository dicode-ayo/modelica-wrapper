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

/** `getDocumentationAnnotation`'s wire shape: a `String[3]` list literal. */
function docAnnotationResponse(
  info: string,
  revision: string,
  infoHeader: string,
): string {
  const q = (s: string): string => `"${s.replace(/"/g, '\\"')}"`;
  return `{${q(info)}, ${q(revision)}, ${q(infoHeader)}}`;
}

function stubCtx(
  currentRevision: string,
  currentInfoHeader: string,
  setResponse = "true",
): { ctx: CallContext; log: StubLog } {
  const log: StubLog = { sent: [] };
  const ctx: CallContext = {
    async call(cmd) {
      log.sent.push(cmd);
      if (cmd.startsWith("getDocumentationAnnotation")) {
        return docAnnotationResponse(
          "<html><p>ignored</p></html>",
          currentRevision,
          currentInfoHeader,
        );
      }
      return setResponse;
    },
    async getErrorString() {
      return { errorString: "" };
    },
  };
  return { ctx, log };
}

describe("setFullDocumentationAnnotation: outgoing command shape", () => {
  it("reads the current revisions/infoHeader, then writes info alongside them unchanged", async () => {
    const { ctx, log } = stubCtx(
      "<html><p>REV 1.0</p></html>",
      "<html><p>header</p></html>",
    );
    await setFullDocumentationAnnotation(ctx, {
      typeName: "MyPkg.MyModel",
      info: "<html><p>New info</p></html>",
    });
    expect(log.sent).toEqual([
      "getDocumentationAnnotation(MyPkg.MyModel)",
      'addClassAnnotation(MyPkg.MyModel, Documentation(info="<html><p>New info</p></html>", ' +
        'revisions="<html><p>REV 1.0</p></html>", __OpenModelica_infoHeader="<html><p>header</p></html>"))',
    ]);
  });

  it("defaults info to an empty string when omitted", async () => {
    const { ctx, log } = stubCtx("", "");
    await setFullDocumentationAnnotation(ctx, { typeName: "MyPkg.MyModel" });
    expect(log.sent).toEqual([
      "getDocumentationAnnotation(MyPkg.MyModel)",
      'addClassAnnotation(MyPkg.MyModel, Documentation(info="", revisions="", __OpenModelica_infoHeader=""))',
    ]);
  });

  it("escapes quotes and newlines in the new info", async () => {
    const { ctx, log } = stubCtx("", "");
    await setFullDocumentationAnnotation(ctx, {
      typeName: "MyPkg.MyModel",
      info: 'a "quoted" line\nsecond line',
    });
    expect(log.sent).toEqual([
      "getDocumentationAnnotation(MyPkg.MyModel)",
      'addClassAnnotation(MyPkg.MyModel, Documentation(info="a \\"quoted\\" line\\nsecond line", ' +
        'revisions="", __OpenModelica_infoHeader=""))',
    ]);
  });
});

describe("setFullDocumentationAnnotation: response parsing", () => {
  it("returns success=true on a clean true response", async () => {
    const { ctx } = stubCtx("", "", "true");
    const out = await setFullDocumentationAnnotation(ctx, {
      typeName: "MyPkg.MyModel",
    });
    expect(out).toEqual({ success: true });
  });

  it("returns success=false on a clean false response", async () => {
    const { ctx } = stubCtx("", "", "false");
    const out = await setFullDocumentationAnnotation(ctx, {
      typeName: "MyPkg.MyModel",
    });
    expect(out).toEqual({ success: false });
  });
});
