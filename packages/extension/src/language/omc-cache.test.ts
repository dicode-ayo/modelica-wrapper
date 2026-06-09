/**
 * Unit tests for the read-only-lookup cache (`OmcLookupCache`).
 *
 * The wrapped OMC surface is a plain mock with call counters; a controllable
 * clock drives the signature TTL. We assert: a hit avoids a second round-trip; a
 * different input is a miss; a changed loaded-library signature drops cached
 * answers; explicit `invalidate` drops them; the entry map is bounded; the
 * signature itself is memoised within the TTL; thrown lookups are not cached;
 * `parseFile` is never cached; and `getLoadedLibraries` failure degrades to a
 * stale-but-serving signature.
 */

import { describe, expect, it, vi } from "vitest";

import {
  MAX_CACHE_ENTRIES,
  OmcLookupCache,
  SIGNATURE_TTL_MS,
  type CachedOmcClient,
} from "./omc-cache.js";

/** A mutable clock for driving the signature TTL deterministically. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return { now: () => t, advance: (ms) => (t += ms) };
}

/** A CachedOmcClient mock with vi.fn lookups (so call counts are assertable). */
function makeClient(overrides: Partial<CachedOmcClient> = {}): CachedOmcClient {
  return {
    getLoadedLibraries: vi.fn(() =>
      Promise.resolve({
        libraries: [["Modelica", "4.0.0"]] as [string, string][],
      }),
    ),
    parseFile: vi.fn(() => Promise.resolve({ classNames: ["Foo"] })),
    qualifyPath: vi.fn(({ path }) => Promise.resolve({ qualifiedPath: path })),
    getClassInformation: vi.fn(() =>
      Promise.resolve({
        fileName: "/lib/Foo.mo",
        lineNumberStart: 1,
        columnNumberStart: 1,
        restriction: "model",
        comment: "",
      }),
    ),
    getClassComment: vi.fn(() => Promise.resolve({ comment: "" })),
    getComponents: vi.fn(() => Promise.resolve({ components: [] })),
    getInheritedClasses: vi.fn(() => Promise.resolve({ inheritedClasses: [] })),
    getClassNames: vi.fn(() => Promise.resolve({ classNames: [] })),
    searchClassNames: vi.fn(() => Promise.resolve({ classNames: [] })),
    getParameterNames: vi.fn(() => Promise.resolve({ parameters: [] })),
    isPackage: vi.fn(() => Promise.resolve({ b: false })),
    ...overrides,
  };
}

describe("OmcLookupCache — hit / miss", () => {
  it("serves a repeated identical lookup from cache (one round-trip)", async () => {
    const client = makeClient();
    const cache = new OmcLookupCache(client, fakeClock().now);

    const a = await cache.qualifyPath({ typeName: "Pkg", path: "R" });
    const b = await cache.qualifyPath({ typeName: "Pkg", path: "R" });

    expect(a).toEqual(b);
    expect(client.qualifyPath).toHaveBeenCalledTimes(1);
  });

  it("treats a different input as a miss (separate round-trip)", async () => {
    const client = makeClient();
    const cache = new OmcLookupCache(client, fakeClock().now);

    await cache.qualifyPath({ typeName: "Pkg", path: "R" });
    await cache.qualifyPath({ typeName: "Pkg", path: "C" });

    expect(client.qualifyPath).toHaveBeenCalledTimes(2);
  });

  it("keys input order-independently (same key for reordered fields)", async () => {
    const client = makeClient();
    const cache = new OmcLookupCache(client, fakeClock().now);

    await cache.getClassNames({ typeName: "Pkg", qualified: true });
    await cache.getClassNames({ qualified: true, typeName: "Pkg" });

    expect(client.getClassNames).toHaveBeenCalledTimes(1);
  });

  it("caches different methods independently", async () => {
    const client = makeClient();
    const cache = new OmcLookupCache(client, fakeClock().now);

    await cache.isPackage({ typeName: "Pkg" });
    await cache.getComponents({ typeName: "Pkg" });
    await cache.isPackage({ typeName: "Pkg" });

    expect(client.isPackage).toHaveBeenCalledTimes(1);
    expect(client.getComponents).toHaveBeenCalledTimes(1);
  });

  it("dedupes the hover double getClassInformation into one round-trip", async () => {
    // resolve() reads location via getClassInformation, then hover reads the
    // restriction via getClassInformation again — same input, so a cache hit.
    const client = makeClient();
    const cache = new OmcLookupCache(client, fakeClock().now);

    await cache.getClassInformation({ typeName: "Pkg.Resistor" });
    await cache.getClassInformation({ typeName: "Pkg.Resistor" });

    expect(client.getClassInformation).toHaveBeenCalledTimes(1);
  });
});

describe("OmcLookupCache — signature invalidation", () => {
  it("drops cached answers when the loaded-library signature changes", async () => {
    const clock = fakeClock();
    let libraries: [string, string][] = [["Modelica", "4.0.0"]];
    const client = makeClient({
      getLoadedLibraries: vi.fn(() => Promise.resolve({ libraries })),
    });
    const cache = new OmcLookupCache(client, clock.now);

    await cache.qualifyPath({ typeName: "Pkg", path: "R" });
    expect(client.qualifyPath).toHaveBeenCalledTimes(1);

    // A library loads → signature changes. Move past the signature TTL so the
    // cache re-reads it.
    libraries = [
      ["Modelica", "4.0.0"],
      ["Buildings", "11.0.0"],
    ];
    clock.advance(SIGNATURE_TTL_MS + 1);

    await cache.qualifyPath({ typeName: "Pkg", path: "R" });
    // Same input but the cache was dropped on the signature change → re-fetched.
    expect(client.qualifyPath).toHaveBeenCalledTimes(2);
  });

  it("still serves from cache within the signature TTL (no re-fetch)", async () => {
    const clock = fakeClock();
    const client = makeClient();
    const cache = new OmcLookupCache(client, clock.now);

    await cache.qualifyPath({ typeName: "Pkg", path: "R" });
    clock.advance(SIGNATURE_TTL_MS - 1);
    await cache.qualifyPath({ typeName: "Pkg", path: "R" });

    expect(client.qualifyPath).toHaveBeenCalledTimes(1);
    // The signature was read once and reused inside the TTL window.
    expect(client.getLoadedLibraries).toHaveBeenCalledTimes(1);
  });

  it("re-reads the signature only after the TTL elapses", async () => {
    const clock = fakeClock();
    const client = makeClient();
    const cache = new OmcLookupCache(client, clock.now);

    await cache.isPackage({ typeName: "A" }); // reads signature (1)
    clock.advance(SIGNATURE_TTL_MS - 1);
    await cache.isPackage({ typeName: "B" }); // still within TTL → no re-read
    expect(client.getLoadedLibraries).toHaveBeenCalledTimes(1);

    clock.advance(2);
    await cache.isPackage({ typeName: "C" }); // TTL elapsed → re-read (2)
    expect(client.getLoadedLibraries).toHaveBeenCalledTimes(2);
  });
});

describe("OmcLookupCache — explicit invalidate", () => {
  it("drops every cached entry and re-reads the signature", async () => {
    const clock = fakeClock();
    const client = makeClient();
    const cache = new OmcLookupCache(client, clock.now);

    await cache.qualifyPath({ typeName: "Pkg", path: "R" });
    expect(cache.size).toBe(1);

    cache.invalidate();
    expect(cache.size).toBe(0);

    await cache.qualifyPath({ typeName: "Pkg", path: "R" });
    expect(client.qualifyPath).toHaveBeenCalledTimes(2);
    // Signature was forgotten, so it is fetched again (initial + post-invalidate).
    expect(client.getLoadedLibraries).toHaveBeenCalledTimes(2);
  });
});

describe("OmcLookupCache — in-flight invalidate (generation guard)", () => {
  it("does not store a value computed before an invalidate() that cleared the map", async () => {
    // A deferred getComponents so we can fire invalidate() while the lookup is
    // mid-flight (the in-place-edit/save race: an in-place save does NOT change
    // the loaded-library signature, so the signature guard alone wouldn't catch
    // a stale value written back after the clear).
    let release!: (value: {
      components: { className: string; name: string }[];
    }) => void;
    const inFlight = new Promise<{
      components: { className: string; name: string }[];
    }>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const client = makeClient({
      getComponents: vi.fn(() => {
        calls++;
        // First call hangs until released; later calls resolve immediately.
        return calls === 1
          ? inFlight
          : Promise.resolve({
              components: [{ className: "Fresh", name: "x" }],
            });
      }),
    });
    const clock = fakeClock();
    const cache = new OmcLookupCache(client, clock.now);

    // Prime the signature within the TTL via an unrelated lookup so the in-flight
    // lookup below parks directly on getComponents (its signature read is a
    // synchronous cache hit, not an await), making the race deterministic.
    await cache.isPackage({ typeName: "Seed" });

    // Start the in-flight lookup; it captures the generation and parks on the
    // hung getComponents.
    const pending = cache.getComponents({ typeName: "Pkg.Resistor" });
    // Let the lookup advance through the (cached) signature read up to `compute`.
    await Promise.resolve();
    await Promise.resolve();

    // A save lands while the lookup is in flight → invalidate() clears + bumps
    // the generation.
    cache.invalidate();

    // Now let the original (now-stale) lookup finish.
    release({ components: [{ className: "Stale", name: "x" }] });
    const stale = await pending;
    // The in-flight caller still gets its computed value (it was correct when
    // computed) ...
    expect(stale.components[0]?.className).toBe("Stale");
    // ... but it must NOT have been written back into the cleared cache.
    expect(cache.size).toBe(0);

    // The next lookup is therefore a miss → re-fetches the fresh value, never
    // serving the stale one that raced the invalidate.
    const fresh = await cache.getComponents({ typeName: "Pkg.Resistor" });
    expect(fresh.components[0]?.className).toBe("Fresh");
    expect(calls).toBe(2);
  });
});

describe("OmcLookupCache — bound", () => {
  it("evicts the oldest entry past MAX_CACHE_ENTRIES (FIFO)", async () => {
    const client = makeClient();
    const cache = new OmcLookupCache(client, fakeClock().now);

    // Fill to the cap with distinct inputs.
    for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
      await cache.isPackage({ typeName: `T${i}` });
    }
    expect(cache.size).toBe(MAX_CACHE_ENTRIES);

    // One more evicts the oldest (T0).
    await cache.isPackage({ typeName: "overflow" });
    expect(cache.size).toBe(MAX_CACHE_ENTRIES);

    const fn = client.isPackage as ReturnType<typeof vi.fn>;
    // The just-added "overflow" key is still present → a hit (no new call).
    const beforeHit = fn.mock.calls.length;
    await cache.isPackage({ typeName: "overflow" });
    expect(fn.mock.calls.length).toBe(beforeHit);

    // T0 was the oldest → evicted → a miss (one new call).
    const beforeMiss = fn.mock.calls.length;
    await cache.isPackage({ typeName: "T0" });
    expect(fn.mock.calls.length).toBe(beforeMiss + 1);
  });
});

describe("OmcLookupCache — error handling", () => {
  it("does not cache a thrown lookup (retries on the next call)", async () => {
    let calls = 0;
    const client = makeClient({
      qualifyPath: vi.fn(() => {
        calls++;
        if (calls === 1) return Promise.reject(new Error("boom"));
        return Promise.resolve({ qualifiedPath: "Pkg.R" });
      }),
    });
    const cache = new OmcLookupCache(client, fakeClock().now);

    await expect(
      cache.qualifyPath({ typeName: "Pkg", path: "R" }),
    ).rejects.toThrow("boom");
    // The failure wasn't cached → the retry hits OMC again and succeeds.
    const ok = await cache.qualifyPath({ typeName: "Pkg", path: "R" });
    expect(ok.qualifiedPath).toBe("Pkg.R");
    expect(calls).toBe(2);
  });

  it("keeps serving when getLoadedLibraries throws (stale signature)", async () => {
    const client = makeClient({
      getLoadedLibraries: vi.fn(() => Promise.reject(new Error("no omc"))),
    });
    const cache = new OmcLookupCache(client, fakeClock().now);

    // The lookup must still complete — a broken signature source degrades to a
    // sentinel signature, it does not throw out of the cache.
    const a = await cache.qualifyPath({ typeName: "Pkg", path: "R" });
    const b = await cache.qualifyPath({ typeName: "Pkg", path: "R" });
    expect(a).toEqual(b);
    expect(client.qualifyPath).toHaveBeenCalledTimes(1);
  });
});

describe("OmcLookupCache — pass-through", () => {
  it("never caches parseFile (a source read, always hits OMC)", async () => {
    const client = makeClient();
    const cache = new OmcLookupCache(client, fakeClock().now);

    await cache.parseFile({ fileName: "/a.mo" });
    await cache.parseFile({ fileName: "/a.mo" });

    expect(client.parseFile).toHaveBeenCalledTimes(2);
  });
});

describe("OmcLookupCache — rewrap", () => {
  it("drops the cache and uses the new client after a rewrap", async () => {
    const first = makeClient();
    const cache = new OmcLookupCache(first, fakeClock().now);
    await cache.qualifyPath({ typeName: "Pkg", path: "R" });
    expect(cache.size).toBe(1);

    const second = makeClient({
      qualifyPath: vi.fn(() => Promise.resolve({ qualifiedPath: "Other.R" })),
    });
    cache.rewrap(second);
    expect(cache.size).toBe(0);

    const result = await cache.qualifyPath({ typeName: "Pkg", path: "R" });
    expect(result.qualifiedPath).toBe("Other.R");
    expect(second.qualifyPath).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when rewrapped with the same client (keeps the cache)", async () => {
    const client = makeClient();
    const cache = new OmcLookupCache(client, fakeClock().now);
    await cache.qualifyPath({ typeName: "Pkg", path: "R" });
    cache.rewrap(client);
    expect(cache.size).toBe(1);
  });
});
