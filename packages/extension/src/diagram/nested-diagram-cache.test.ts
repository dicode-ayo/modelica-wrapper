import { describe, expect, it, vi, type Mock } from "vitest";
import type { DiagramLayout, OmcClient } from "@dicode/omc-client";

import { ClassInvalidationRegistry } from "../invalidation.js";
import { log } from "../logger.js";
import {
  evictNestedDiagramsOnChange,
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

  it("writes one debug line naming the class and the error for a fetch two gets shared", async () => {
    const debug = vi.spyOn(log, "debug").mockImplementation(() => {});
    let rejectFetch: (err: Error) => void = () => {};
    const fetch = vi.fn(
      () =>
        new Promise<DiagramLayout>((_resolve, reject) => {
          rejectFetch = reject;
        }),
    );
    const cache = new NestedDiagramCache({} as OmcClient, fetch);

    const first = cache.get("A.B");
    const second = cache.get("A.B");
    rejectFetch(new Error("OMC unavailable"));

    await expect(first).rejects.toThrow("OMC unavailable");
    await expect(second).rejects.toThrow("OMC unavailable");
    expect(debug).toHaveBeenCalledOnce();
    expect(debug.mock.calls[0]?.[1]).toMatch(/A\.B.*OMC unavailable/);
    debug.mockRestore();
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
      kind: "diagram",
      className,
      source: {
        filename: "<fixture>",
        lineStart: 1,
        columnStart: 1,
        lineEnd: 1,
        columnEnd: 1,
      },
      iconLayers: [],
      diagramLayers: [],
      labels: [],
      classes: {
        c: {
          name: child,
          restriction: "model",
          iconLayers: [],
          connectors: {},
          parameters: {},
        },
      },
      components: {},
      connectors: {},
      connections: [],
    };
  }

  type Fetch = (client: OmcClient, className: string) => Promise<DiagramLayout>;

  /** A fetch per call, each settled by hand, in call order. */
  function deferredFetch(): {
    fetch: Mock<Fetch>;
    settle: (i: number, layout: DiagramLayout) => Promise<void>;
  } {
    const resolvers: ((l: DiagramLayout) => void)[] = [];
    const fetch = vi.fn<Fetch>(
      () =>
        new Promise<DiagramLayout>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const settle = async (i: number, layout: DiagramLayout): Promise<void> => {
      resolvers[i]?.(layout);
      await new Promise((r) => setTimeout(r, 0));
    };
    return { fetch, settle };
  }

  it("drops the layouts drawing the changed class, and keeps the rest", async () => {
    const layouts: Record<string, DiagramLayout> = {
      "P.Parent": drawing("P.Parent", "P.Child"),
      "P.Other": drawing("P.Other", "P.Unrelated"),
    };
    const fetch = vi.fn((_client: OmcClient, className: string) => {
      const found = layouts[className];
      return found
        ? Promise.resolve(found)
        : Promise.reject(new Error(`no ${className}`));
    });
    const cache = new NestedDiagramCache({} as OmcClient, fetch);
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

  it("re-runs a fetch in flight across a change to a class it draws, and serves the re-run", async () => {
    const { fetch, settle } = deferredFetch();
    const cache = new NestedDiagramCache({} as OmcClient, fetch);
    const stale = drawing("P.Parent", "P.Child");
    const fresh = drawing("P.Parent", "P.Child");

    const got = cache.get("P.Parent");
    cache.invalidate("P.Child");
    await settle(0, stale);
    await settle(1, fresh);

    expect(await got).toBe(fresh);
    expect(await cache.get("P.Parent")).toBe(fresh);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a fetch in flight across a change to a class it does not draw", async () => {
    const { fetch, settle } = deferredFetch();
    const cache = new NestedDiagramCache({} as OmcClient, fetch);
    const layout = drawing("P.Parent", "P.Child");

    const got = cache.get("P.Parent");
    cache.invalidate("P.Host");
    await settle(0, layout);

    expect(await got).toBe(layout);
    await cache.get("P.Parent");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("clears everything for a change no class name describes, in flight included", async () => {
    const { fetch, settle } = deferredFetch();
    const cache = new NestedDiagramCache({} as OmcClient, fetch);

    const got = cache.get("P.Parent");
    cache.clear();
    await settle(0, drawing("P.Parent", "P.Child"));
    await settle(1, drawing("P.Parent", "P.Child"));
    await got;

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("evictNestedDiagramsOnChange", () => {
  it("evicts the live session's cache with no editor open to hear the change", () => {
    const invalidation = new ClassInvalidationRegistry();
    const cache = new NestedDiagramCache({} as OmcClient, vi.fn());
    const invalidate = vi.spyOn(cache, "invalidate");
    const clear = vi.spyOn(cache, "clear");
    const sub = evictNestedDiagramsOnChange(invalidation, () => cache);

    invalidation.classChanged("P.Child");
    invalidation.allClassesChanged();
    invalidation.sessionReplaced();
    sub.dispose();
    invalidation.classChanged("P.Later");

    expect(invalidate.mock.calls).toEqual([["P.Child"]]);
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it("does nothing before a session exists", () => {
    const invalidation = new ClassInvalidationRegistry();
    evictNestedDiagramsOnChange(invalidation, () => undefined);

    expect(() => invalidation.classChanged("P.Child")).not.toThrow();
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
