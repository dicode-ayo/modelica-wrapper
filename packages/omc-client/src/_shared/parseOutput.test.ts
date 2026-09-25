/**
 * A mutation OMC answers with nothing, or with `false`, puts its reason in
 * the error buffer. These pin that `parseMutationSuccess` raises that reason
 * as an {@link OmcDiagnosticError}, the same type `readFailure` raises for a
 * read, and that any non-empty buffer counts as failure, a warning-only one
 * included.
 */

import { describe, expect, it, vi } from "vitest";

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
    await expect(
      parseMutationSuccess(ctx, "false", "someMutation"),
    ).rejects.toThrow("someMutation: Error: something went wrong");
  });

  it("resolves false, without throwing, when OMC answers false and leaves the buffer empty", async () => {
    const ctx = stubCtx("");

    await expect(
      parseMutationSuccess(ctx, "false", "someMutation"),
    ).resolves.toBe(false);
  });

  it("reports failure for a warning-only buffer, which looksLikeError would pass", async () => {
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
    const getErrorString = vi.spyOn(ctx, "getErrorString");

    await expect(
      parseMutationSuccess(ctx, "true", "someMutation"),
    ).resolves.toBe(true);
    expect(getErrorString).not.toHaveBeenCalled();
  });
});
