/**
 * `LibrarySource` resolves one restriction per search hit, and OMC runs those
 * one at a time. These pin that a superseded search stops issuing them rather
 * than running to completion on the shared channel, and that the restriction
 * cache keeps a repeat search off OMC entirely.
 *
 * They also pin which levels of the tree keep the order their author chose:
 * a package's members do, the roots don't.
 */

import { describe, expect, it, vi } from "vitest";

import {
  LibrarySource,
  SearchAbortedError,
  type LibraryOmcClient,
} from "./library-source.js";

type GetClassNamesInput = Parameters<LibraryOmcClient["getClassNames"]>[0];

/** `getClassNames` sorts only when asked, as OMC does. */
function fakeClient(hits: string[], members: string[] = []) {
  return {
    searchClassNames: vi.fn(async () => ({ classNames: hits })),
    getClassRestriction: vi.fn(async (_input: { typeName: string }) => ({
      restriction: "model",
    })),
    getClassNames: vi.fn(async ({ sort }: GetClassNamesInput) => ({
      classNames: sort === true ? [...members].sort() : members,
    })),
  };
}

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

    const source = new LibrarySource(client);
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

    const source = new LibrarySource(client);
    await expect(
      source.searchAll("a", controller.signal),
    ).rejects.toBeInstanceOf(SearchAbortedError);
    expect(client.getClassRestriction).not.toHaveBeenCalled();
  });

  it("resolves every hit when nothing aborts it", async () => {
    const client = fakeClient(["A", "B", "C"]);
    const source = new LibrarySource(client);

    const rows = await source.searchAll("a");

    expect(rows.map((r) => r.qualified)).toEqual(["A", "B", "C"]);
    expect(client.getClassRestriction).toHaveBeenCalledTimes(3);
  });

  it("serves a repeated search's restrictions from cache", async () => {
    const client = fakeClient(["A", "B"]);
    const source = new LibrarySource(client);

    await source.searchAll("a");
    await source.searchAll("a");

    expect(client.getClassRestriction).toHaveBeenCalledTimes(2);
  });
});

describe("LibrarySource.invalidateRestriction", () => {
  it("makes the next lookup of that class re-ask OMC", async () => {
    const client = fakeClient(["A", "B"]);
    const source = new LibrarySource(client);
    await source.searchAll("a");

    source.invalidateRestriction("A");
    await source.searchAll("a");

    expect(
      client.getClassRestriction.mock.calls.filter(
        ([input]) => input.typeName === "A",
      ),
    ).toHaveLength(2);
  });

  it("leaves every other class cached", async () => {
    const client = fakeClient(["A", "B"]);
    const source = new LibrarySource(client);
    await source.searchAll("a");

    source.invalidateRestriction("A");
    await source.searchAll("a");

    expect(
      client.getClassRestriction.mock.calls.filter(
        ([input]) => input.typeName === "B",
      ),
    ).toHaveLength(1);
  });
});

describe("LibrarySource.listChildren", () => {
  it("keeps a package's members in the order OMC reports them", async () => {
    // A `package.order` putting `Resistor` before `Capacitor` survives only if
    // the listing never asks OMC to sort.
    const client = fakeClient([], ["Resistor", "Capacitor"]);
    const source = new LibrarySource(client);

    const rows = await source.listChildren("P");

    expect(rows.map((r) => r.qualified)).toEqual(["P.Resistor", "P.Capacitor"]);
  });

  it("sorts the roots, which have no authored order", async () => {
    const client = fakeClient([], ["Zebra", "Alpha"]);
    const source = new LibrarySource(client);

    const rows = await source.listChildren(null);

    expect(rows.map((r) => r.qualified)).toEqual(["Alpha", "Zebra"]);
  });
});
