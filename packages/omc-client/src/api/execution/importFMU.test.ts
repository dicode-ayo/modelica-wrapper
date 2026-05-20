/**
 * Wrapper-level tests for `importFMU` (issue #76, item 16).
 *
 * The default `workdir` must go out as the EMPTY string OMC documents as
 * "use cwd", not the doc-placeholder literal "<default>" (which OMC would
 * treat as a real directory named `<default>`).
 */

import { describe, expect, it, vi } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { importFMU, ImportFMUInputSchema } from "./importFMU.js";

function fakeCtx(response: string): {
  ctx: CallContext;
  call: ReturnType<typeof vi.fn>;
} {
  const call = vi.fn(async () => response);
  const ctx: CallContext = {
    call: call as unknown as CallContext["call"],
    getErrorString: async () => ({ errorString: "" }),
  };
  return { ctx, call };
}

describe("importFMU: workdir default", () => {
  it("defaults workdir to the empty string (use cwd), not '<default>'", () => {
    const parsed = ImportFMUInputSchema.parse({ filename: "x.fmu" });
    expect(parsed.workdir).toBe("");
  });

  it("emits an empty quoted workdir in the call, never the literal <default>", async () => {
    const { ctx, call } = fakeCtx('"Generated.mo"');
    await importFMU(ctx, { filename: "/tmp/x.fmu" });
    const sent = call.mock.calls[0]![0] as string;
    expect(sent).not.toContain("<default>");
    // Second positional arg is the (empty) quoted workdir.
    expect(sent).toContain('importFMU("/tmp/x.fmu", "",');
  });

  it("passes an explicit workdir through verbatim", async () => {
    const { ctx, call } = fakeCtx('"Generated.mo"');
    await importFMU(ctx, { filename: "/tmp/x.fmu", workdir: "/out" });
    const sent = call.mock.calls[0]![0] as string;
    expect(sent).toContain('importFMU("/tmp/x.fmu", "/out",');
  });

  it("emits the bare modelName sentinel `Default` when not overridden", async () => {
    const { ctx, call } = fakeCtx('"Generated.mo"');
    await importFMU(ctx, { filename: "/tmp/x.fmu" });
    const sent = call.mock.calls[0]![0] as string;
    expect(sent).toMatch(/, Default\)$/);
  });
});
