import { describe, expect, it, vi } from "vitest";

import { emptyLayout } from "../../test/harness/layout-fixtures.js";
import { sharedNestedSource } from "./nested-diagram-source.js";

describe("sharedNestedSource", () => {
  it("asks once per class however many boxes of that class open", async () => {
    const fetch = vi.fn((className: string) =>
      Promise.resolve({ ...emptyLayout(), className }),
    );
    const source = sharedNestedSource(fetch);
    const [a, b] = await Promise.all([source("P.LimPID"), source("P.LimPID")]);
    await source("P.LimPID");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("keeps classes apart", async () => {
    const fetch = vi.fn((className: string) =>
      Promise.resolve({ ...emptyLayout(), className }),
    );
    const source = sharedNestedSource(fetch);
    await source("P.A");
    const b = await source("P.B");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(b.className).toBe("P.B");
  });

  it("retries a class whose fetch failed rather than pinning the failure", async () => {
    const fetch = vi
      .fn<(className: string) => Promise<ReturnType<typeof emptyLayout>>>()
      .mockRejectedValueOnce(new Error("OMC busy"))
      .mockResolvedValueOnce(emptyLayout());
    const source = sharedNestedSource(fetch);
    await expect(source("P.A")).rejects.toThrow("OMC busy");
    await expect(source("P.A")).resolves.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used class past its bound", async () => {
    const fetch = vi.fn((className: string) =>
      Promise.resolve({ ...emptyLayout(), className }),
    );
    const source = sharedNestedSource(fetch, 2);
    await source("P.A");
    await source("P.B");
    await source("P.A");
    await source("P.C");
    await source("P.A");
    expect(fetch).toHaveBeenCalledTimes(3);
    await source("P.B");
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
