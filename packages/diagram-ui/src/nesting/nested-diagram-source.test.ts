import { describe, expect, it, vi } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import { emptyLayout } from "../../test/harness/layout-fixtures.js";
import { sharedNestedSource } from "./nested-diagram-source.js";

describe("sharedNestedSource", () => {
  it("asks once per class however many boxes of that class open", async () => {
    const fetch = vi.fn((className: string) =>
      Promise.resolve({ ...emptyLayout(), className }),
    );
    const source = sharedNestedSource(fetch).fetch;
    const [a, b] = await Promise.all([source("P.LimPID"), source("P.LimPID")]);
    await source("P.LimPID");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("keeps classes apart", async () => {
    const fetch = vi.fn((className: string) =>
      Promise.resolve({ ...emptyLayout(), className }),
    );
    const source = sharedNestedSource(fetch).fetch;
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
    const source = sharedNestedSource(fetch).fetch;
    await expect(source("P.A")).rejects.toThrow("OMC busy");
    await expect(source("P.A")).resolves.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used class past its bound", async () => {
    const fetch = vi.fn((className: string) =>
      Promise.resolve({ ...emptyLayout(), className }),
    );
    const source = sharedNestedSource(fetch, 2).fetch;
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

describe("sharedNestedSource: invalidate", () => {
  /** `className`'s diagram, drawing one `Child` sub-component. */
  const withChild = (className: string): DiagramLayout => ({
    ...emptyLayout(),
    className,
    classes: {
      Child: {
        name: "P.Child",
        restriction: "model",
        iconLayers: [],
        connectors: {},
        parameters: {},
      },
    },
  });

  it("re-fetches a layout that draws the changed class, and keeps the rest", async () => {
    const fetch = vi.fn((className: string) =>
      Promise.resolve(
        className === "P.Parent"
          ? withChild(className)
          : { ...emptyLayout(), className },
      ),
    );
    const { fetch: source, invalidate } = sharedNestedSource(fetch);
    await source("P.Parent");
    await source("P.Other");

    invalidate("P.Child");
    await source("P.Parent");
    await source("P.Other");

    expect(fetch.mock.calls.map(([name]) => name)).toEqual([
      "P.Parent",
      "P.Other",
      "P.Parent",
    ]);
  });

  it("drops a fetch still in flight, which may have read the old definition", async () => {
    const resolvers: ((layout: DiagramLayout) => void)[] = [];
    const fetch = vi.fn(
      () =>
        new Promise<DiagramLayout>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { fetch: source, invalidate } = sharedNestedSource(fetch);
    void source("P.A");

    invalidate("P.Unrelated");
    void source("P.A");

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("forgets everything for a change no class name describes", async () => {
    const fetch = vi.fn((className: string) =>
      Promise.resolve({ ...emptyLayout(), className }),
    );
    const { fetch: source, invalidate } = sharedNestedSource(fetch);
    await source("P.A");

    invalidate(null);
    await source("P.A");

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
