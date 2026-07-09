/**
 * `LibrarySource` resolves one restriction per search hit, and OMC runs those
 * one at a time. These pin that a superseded search stops issuing them rather
 * than running to completion on the shared channel, and that the restriction
 * cache keeps a repeat search off OMC entirely.
 */

import { describe, expect, it, vi } from "vitest";
import type { OmcClient } from "@dicode/omc-client";

import { LibrarySource, SearchAbortedError } from "./library-source.js";

function fakeClient(hits: string[]) {
  return {
    searchClassNames: vi.fn(async () => ({ classNames: hits })),
    getClassRestriction: vi.fn(async () => ({ restriction: "model" })),
    getClassNames: vi.fn(async () => ({ classNames: [] })),
  };
}

const asClient = (c: ReturnType<typeof fakeClient>): OmcClient =>
  c as unknown as OmcClient;

describe("LibrarySource.searchAll", () => {
  it("stops resolving restrictions once the search is aborted", async () => {
    const hits = ["A", "B", "C", "D", "E"];
    const client = fakeClient(hits);
    const controller = new AbortController();
    // Abort while the first lookup is in flight, as a keystroke would.
    client.getClassRestriction.mockImplementationOnce(async () => {
      controller.abort();
      return { restriction: "model" };
    });

    const source = new LibrarySource(asClient(client));
    await expect(
      source.searchAll("a", controller.signal),
    ).rejects.toBeInstanceOf(SearchAbortedError);

    // One lookup went out before the abort; the remaining four never queued.
    expect(client.getClassRestriction).toHaveBeenCalledTimes(1);
  });

  it("issues no lookups at all when aborted before it starts", async () => {
    const client = fakeClient(["A", "B"]);
    const controller = new AbortController();
    controller.abort();

    const source = new LibrarySource(asClient(client));
    await expect(
      source.searchAll("a", controller.signal),
    ).rejects.toBeInstanceOf(SearchAbortedError);
    expect(client.getClassRestriction).not.toHaveBeenCalled();
  });

  it("resolves every hit when nothing aborts it", async () => {
    const client = fakeClient(["A", "B", "C"]);
    const source = new LibrarySource(asClient(client));

    const rows = await source.searchAll("a");

    expect(rows.map((r) => r.qualified)).toEqual(["A", "B", "C"]);
    expect(client.getClassRestriction).toHaveBeenCalledTimes(3);
  });

  it("serves a repeated search's restrictions from cache", async () => {
    const client = fakeClient(["A", "B"]);
    const source = new LibrarySource(asClient(client));

    await source.searchAll("a");
    await source.searchAll("a");

    expect(client.getClassRestriction).toHaveBeenCalledTimes(2);
  });
});
