/**
 * `parseMutationSuccess` and `failureReason` (`error-buffer.ts`'s
 * `looksLikeError`) answer "did OMC fail this call?" from the same buffer
 * with different predicates — see issue #723. These pin the two behaviors
 * that make that gap safe today:
 *   - `parseMutationSuccess` throws the same {@link OmcDiagnosticError} type
 *     `failureReason`'s callers do, so the MCP dispatcher's classification
 *     doesn't depend on which helper a wrapper used.
 *   - `parseMutationSuccess` still treats *any* non-empty buffer as failure
 *     (stricter than `looksLikeError`'s literal-"Error" check), which is the
 *     current, deliberately-unaligned behavior for a warning-only buffer.
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "./callContext.js";
import { OmcDiagnosticError } from "../error-buffer.js";

import { parseMutationSuccess } from "./parseOutput.js";

function stubCtx(errorString: string): CallContext {
  return {
    call: () => {
      throw new Error("not used");
    },
    async getErrorString() {
      return { errorString };
    },
  };
}

describe("parseMutationSuccess", () => {
  it("throws OmcDiagnosticError, not a bare Error, when OMC answers null with a buffered reason", async () => {
    const ctx = stubCtx("Error: something went wrong\n");

    await expect(parseMutationSuccess(ctx, "", "someMutation")).rejects.toThrow(
      OmcDiagnosticError,
    );
  });

  it("throws OmcDiagnosticError when OMC answers false with a buffered reason", async () => {
    const ctx = stubCtx("Error: something went wrong\n");

    await expect(
      parseMutationSuccess(ctx, "false", "someMutation"),
    ).rejects.toThrow(OmcDiagnosticError);
  });

  it("still reports failure for a warning-only buffer (unaligned with looksLikeError; see #723)", async () => {
    // `looksLikeError` would call this a success (no literal "Error"), but
    // parseMutationSuccess's stricter predicate has not been aligned onto it
    // without live-OMC confirmation that a mutation can leave a warning-only
    // buffer behind on a write that actually succeeded.
    const ctx = stubCtx(
      "Warning: the initial conditions are not fully specified.\n",
    );

    await expect(parseMutationSuccess(ctx, "", "someMutation")).rejects.toThrow(
      OmcDiagnosticError,
    );
  });

  it("succeeds when OMC answers null with an empty buffer", async () => {
    const ctx = stubCtx("");

    await expect(parseMutationSuccess(ctx, "", "someMutation")).resolves.toBe(
      true,
    );
  });

  it("resolves a genuine bool without consulting the buffer at all", async () => {
    const ctx = stubCtx("Error: should never be read");

    await expect(
      parseMutationSuccess(ctx, "true", "someMutation"),
    ).resolves.toBe(true);
  });
});
