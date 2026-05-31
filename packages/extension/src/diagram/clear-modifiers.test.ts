import { describe, expect, it, vi } from "vitest";
import type { OmcClient } from "@dicode/omc-client";

import { clearComponentModifiers } from "./clear-modifiers.js";

/**
 * Minimal `OmcClient` stand-in exposing only the surface the helper
 * touches. The cast keeps the test honest about *which* method is called
 * without dragging the real transport (zeromq / cmake-ts) into the unit
 * suite.
 */
function mockClient(result: { success: boolean } = { success: true }): {
  client: OmcClient;
  remove: ReturnType<typeof vi.fn>;
} {
  const remove = vi.fn().mockResolvedValue(result);
  const client = { removeElementModifiers: remove } as unknown as OmcClient;
  return { client, remove };
}

describe("clearComponentModifiers", () => {
  it("issues exactly ONE removeElementModifiers call (not a per-field loop)", async () => {
    const { client, remove } = mockClient();

    await clearComponentModifiers(client, "Sample", "gain");

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith({
      typeName: "Sample",
      componentName: "gain",
      keepRedeclares: false,
    });
  });

  it("passes keepRedeclares through when requested", async () => {
    const { client, remove } = mockClient();

    await clearComponentModifiers(client, "Sample", "PI", {
      keepRedeclares: true,
    });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith({
      typeName: "Sample",
      componentName: "PI",
      keepRedeclares: true,
    });
  });

  it("defaults keepRedeclares to false when omitted", async () => {
    const { client, remove } = mockClient();

    await clearComponentModifiers(client, "Sample", "gain", {});

    expect(remove).toHaveBeenCalledWith(
      expect.objectContaining({ keepRedeclares: false }),
    );
  });

  it("returns OMC's success flag verbatim", async () => {
    const ok = mockClient({ success: true });
    await expect(
      clearComponentModifiers(ok.client, "Sample", "gain"),
    ).resolves.toBe(true);

    const bad = mockClient({ success: false });
    await expect(
      clearComponentModifiers(bad.client, "Sample", "gain"),
    ).resolves.toBe(false);
  });
});
