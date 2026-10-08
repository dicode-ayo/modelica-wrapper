import { describe, expect, it } from "vitest";

import { getModelInstance } from "../api/contents/getModelInstance.js";
import { getModelInstanceAnnotation } from "../api/contents/getModelInstanceAnnotation.js";
import { OmcDiagnosticError } from "../diagnostic-error.js";

import type { CallContext } from "./callContext.js";
import { ModelInstanceNotFoundError } from "./modelInstance.js";

/** OMC's empty model-instance reply, with `existClass` and the error buffer answering as given. */
function emptyReplyCtx(opts: {
  exists: boolean | Error;
  errorString: string;
}): CallContext {
  return {
    async call(cmd) {
      if (!cmd.startsWith("existClass(")) return "";
      if (opts.exists instanceof Error) throw opts.exists;
      return String(opts.exists);
    },
    async getErrorString() {
      return { errorString: opts.errorString };
    },
  };
}

const BASE_CLASS_ERROR =
  "Error: Base class NoBase not found in scope Partial2.\n";

describe.each([
  ["getModelInstance", getModelInstance],
  ["getModelInstanceAnnotation", getModelInstanceAnnotation],
] as const)("%s: empty reply", (fnName, fetch) => {
  it("throws ModelInstanceNotFoundError naming the class when the class doesn't exist", async () => {
    const ctx = emptyReplyCtx({ exists: false, errorString: "" });

    const err: unknown = await fetch(ctx, {
      typeName: "ResistorDemo.RLCCircuit",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelInstanceNotFoundError);
    expect(err).toMatchObject({ className: "ResistorDemo.RLCCircuit" });
    expect((err as Error).message).toMatch(
      /ResistorDemo\.RLCCircuit.*not loaded or does not exist/,
    );
  });

  it("surfaces OMC's diagnostic, not not-found, for a class that exists", async () => {
    const ctx = emptyReplyCtx({ exists: true, errorString: BASE_CLASS_ERROR });

    const err: unknown = await fetch(ctx, { typeName: "P.Partial2" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OmcDiagnosticError);
    expect(err).not.toBeInstanceOf(ModelInstanceNotFoundError);
    expect((err as Error).message).toBe(
      `${fnName}: ${BASE_CLASS_ERROR.trim()}`,
    );
  });

  it("keeps OMC's diagnostic when the existClass probe itself fails", async () => {
    const ctx = emptyReplyCtx({
      exists: new Error("transport closed"),
      errorString: BASE_CLASS_ERROR,
    });

    await expect(fetch(ctx, { typeName: "P.Partial2" })).rejects.toThrow(
      `${fnName}: ${BASE_CLASS_ERROR.trim()}`,
    );
  });
});
