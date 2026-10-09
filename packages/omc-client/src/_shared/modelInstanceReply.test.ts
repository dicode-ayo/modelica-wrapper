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

  it("throws OmcDiagnosticError, not not-found, for a class that exists, ignoring a possibly stale buffer", async () => {
    const ctx = emptyReplyCtx({
      exists: true,
      errorString: "Error: Class NoType not found in scope B.\n",
    });

    const err: unknown = await fetch(ctx, { typeName: "P.Partial2" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OmcDiagnosticError);
    expect(err).not.toBeInstanceOf(ModelInstanceNotFoundError);
    expect((err as Error).message).toMatch(
      new RegExp(`^${fnName}: .*"P\\.Partial2".*fails to instantiate`),
    );
    expect((err as Error).message).not.toContain("NoType");
  });

  it("lets a failed existClass probe surface as itself, not as OMC's answer", async () => {
    const ctx = emptyReplyCtx({
      exists: new Error("transport closed"),
      errorString: "",
    });

    const err: unknown = await fetch(ctx, { typeName: "P.Partial2" }).catch(
      (e: unknown) => e,
    );
    expect(err).not.toBeInstanceOf(OmcDiagnosticError);
    expect((err as Error).message).toBe("transport closed");
  });
});
