/**
 * Unit tests for the host-side "Reset to defaults" clear (issue #30,
 * deferred half). `resetComponentParameters` is the pure decision +
 * RPC + error-surfacing core the panel's `onResetComponentParameters`
 * handler wraps with the re-fetch / re-open dance.
 *
 * We assert:
 *   - the happy path issues exactly ONE `removeElementModifiers` with
 *     `keepRedeclares: true` and returns `true`;
 *   - an OMC `success: false` returns `false` and raises a warning toast;
 *   - a thrown transport error returns `false` and raises a warning toast.
 *
 * vscode is aliased to the in-repo mock (see vitest.config.ts), whose
 * `recordedMessages` log lets us assert the toast policy without an
 * extension host.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OmcClient } from "@modelica-wrapper/omc-client";
import { recordedMessages } from "../../test-support/vscode-mock.js";

import { resetComponentParameters } from "./open-diagram.js";

interface MockOptions {
  removeResult?: { success: boolean };
  removeThrows?: Error;
  errorString?: string;
}

function mockClient(opts: MockOptions = {}): {
  client: OmcClient;
  remove: ReturnType<typeof vi.fn>;
  getErrorString: ReturnType<typeof vi.fn>;
} {
  const remove = opts.removeThrows
    ? vi.fn().mockRejectedValue(opts.removeThrows)
    : vi.fn().mockResolvedValue(opts.removeResult ?? { success: true });
  const getErrorString = vi
    .fn()
    .mockResolvedValue({ errorString: opts.errorString ?? "" });
  const client = {
    removeElementModifiers: remove,
    getErrorString,
    lastCall: "removeElementModifiers(Sample, gain, keepRedeclares=true)",
  } as unknown as OmcClient;
  return { client, remove, getErrorString };
}

describe("resetComponentParameters", () => {
  beforeEach(() => {
    recordedMessages.length = 0;
  });
  afterEach(() => {
    recordedMessages.length = 0;
  });

  it("clears with one removeElementModifiers (keepRedeclares=true) and returns true", async () => {
    const { client, remove } = mockClient();

    const ok = await resetComponentParameters(client, "Sample", "gain");

    expect(ok).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith({
      typeName: "Sample",
      componentName: "gain",
      keepRedeclares: true,
    });
    // Happy path raises no toast.
    expect(recordedMessages).toHaveLength(0);
  });

  it("returns false and warns when OMC reports success=false", async () => {
    const { client } = mockClient({
      removeResult: { success: false },
      errorString: "no such component gain",
    });

    const ok = await resetComponentParameters(client, "Sample", "gain");

    expect(ok).toBe(false);
    expect(recordedMessages).toHaveLength(1);
    expect(recordedMessages[0]?.level).toBe("warning");
    expect(recordedMessages[0]?.message).toContain("reset gain failed");
    expect(recordedMessages[0]?.message).toContain("no such component gain");
  });

  it("returns false and warns when the RPC throws", async () => {
    const { client } = mockClient({
      removeThrows: new Error("transport closed"),
    });

    const ok = await resetComponentParameters(client, "Sample", "gain");

    expect(ok).toBe(false);
    expect(recordedMessages).toHaveLength(1);
    expect(recordedMessages[0]?.level).toBe("warning");
    expect(recordedMessages[0]?.message).toContain("transport closed");
  });
});
