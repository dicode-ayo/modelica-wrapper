import { describe, expect, it, vi } from "vitest";
import type { DiagramLayout, OmcClient } from "@dicode/omc-client";

import {
  NestedDiagramCache,
  nestedDiagramCache,
} from "./nested-diagram-cache.js";

function layout(className: string): DiagramLayout {
  return { kind: "diagram", className } as unknown as DiagramLayout;
}

describe("NestedDiagramCache", () => {
  it("fetches a class once and serves the cached layout on the next get", async () => {
    const fetch = vi.fn().mockResolvedValue(layout("A.B"));
    const cache = new NestedDiagramCache({} as OmcClient, fetch);

    await cache.get("A.B");
    await cache.get("A.B");

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("dedupes two concurrent gets of the same class into one fetch", async () => {
    let resolveFetch!: (layout: DiagramLayout) => void;
    const fetch = vi.fn(
      () =>
        new Promise<DiagramLayout>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const cache = new NestedDiagramCache({} as OmcClient, fetch);

    const first = cache.get("A.B");
    const second = cache.get("A.B");
    resolveFetch(layout("A.B"));

    const [a, b] = await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("keys the cache per class name", async () => {
    const fetch = vi.fn(
      (_client: OmcClient, className: string): Promise<DiagramLayout> =>
        Promise.resolve(layout(className)),
    );
    const cache = new NestedDiagramCache({} as OmcClient, fetch);

    const a = await cache.get("A.B");
    const b = await cache.get("A.C");

    expect(a.className).toBe("A.B");
    expect(b.className).toBe("A.C");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not cache a rejected fetch, so the next get retries", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("OMC unavailable"))
      .mockResolvedValueOnce(layout("A.B"));
    const cache = new NestedDiagramCache({} as OmcClient, fetch);

    await expect(cache.get("A.B")).rejects.toThrow("OMC unavailable");
    await expect(cache.get("A.B")).resolves.toEqual(layout("A.B"));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("evicts the least-recently-used class once past capacity", async () => {
    const fetch = vi.fn(
      (_client: OmcClient, className: string): Promise<DiagramLayout> =>
        Promise.resolve(layout(className)),
    );
    const cache = new NestedDiagramCache({} as OmcClient, fetch, 2);

    await cache.get("A"); // [A]
    await cache.get("B"); // [A, B]
    await cache.get("A"); // touch A -> [B, A]
    await cache.get("C"); // evicts B -> [A, C]
    await cache.get("B"); // B was evicted, re-fetched

    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe("NestedDiagramCache: invalidation", () => {
  /** `className`'s diagram, drawing one sub-component of class `child`. */
  function drawing(className: string, child: string): DiagramLayout {
    return {
      ...layout(className),
      iconLayers: [],
      diagramLayers: [],
      classes: {
        c: {
          name: child,
          restriction: "model",
          iconLayers: [],
          connectors: {},
          parameters: {},
        },
      },
    } as DiagramLayout;
  }

  function cacheOf(layouts: Record<string, DiagramLayout>): {
    cache: NestedDiagramCache;
    fetch: ReturnType<typeof vi.fn>;
  } {
    const fetch = vi.fn((_client: OmcClient, className: string) => {
      const found = layouts[className];
      return found
        ? Promise.resolve(found)
        : Promise.reject(new Error(`no ${className}`));
    });
    return { cache: new NestedDiagramCache({} as OmcClient, fetch), fetch };
  }

  it("drops the layouts drawing the changed class, and keeps the rest", async () => {
    const { cache, fetch } = cacheOf({
      "P.Parent": drawing("P.Parent", "P.Child"),
      "P.Other": drawing("P.Other", "P.Unrelated"),
    });
    await cache.get("P.Parent");
    await cache.get("P.Other");

    cache.invalidate("P.Child");
    await cache.get("P.Parent");
    await cache.get("P.Other");

    expect(fetch.mock.calls.map(([, name]) => name)).toEqual([
      "P.Parent",
      "P.Other",
      "P.Parent",
    ]);
  });

  it("does not cache a fetch that straddled an invalidation", async () => {
    let resolveFirst: (l: DiagramLayout) => void = () => {};
    const fetch = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<DiagramLayout>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValue(drawing("P.Parent", "P.Child"));
    const cache = new NestedDiagramCache({} as OmcClient, fetch);

    const straddling = cache.get("P.Parent");
    cache.invalidate("P.Child");
    resolveFirst(drawing("P.Parent", "P.Child"));
    await straddling;
    await cache.get("P.Parent");

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("clears everything for a change no class name describes", async () => {
    const { cache, fetch } = cacheOf({
      "P.Parent": drawing("P.Parent", "P.Child"),
    });
    await cache.get("P.Parent");

    cache.clear();
    await cache.get("P.Parent");

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("nestedDiagramCache", () => {
  it("returns the same instance for the same client, and a fresh one for another", () => {
    const clientA = {} as OmcClient;
    const clientB = {} as OmcClient;

    expect(nestedDiagramCache(clientA)).toBe(nestedDiagramCache(clientA));
    expect(nestedDiagramCache(clientA)).not.toBe(nestedDiagramCache(clientB));
  });
});
