/**
 * `LibrarySource` resolves one restriction per search hit, and OMC runs those
 * one at a time. These pin that a superseded search stops issuing them rather
 * than running to completion on the shared channel, that the restriction
 * cache keeps a repeat search off OMC entirely, and that a package's members
 * reach the tree in the order OMC reports them.
 */

import { describe, expect, it, vi } from "vitest";

import { LibrarySource, SearchAbortedError } from "./library-source.js";

function fakeClient(hits: string[]) {
  return {
    searchClassNames: vi.fn(async () => ({ classNames: hits })),
    getClassRestriction: vi.fn(async () => ({ restriction: "model" })),
    getClassNames: vi.fn(async () => ({ classNames: [] })),
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

describe("LibrarySource.listChildren", () => {
  /** `package.order` puts `Resistor` before `Capacitor`; sorting would not. */
  function packageClient(members: string[]) {
    return {
      searchClassNames: vi.fn(async () => ({ classNames: [] })),
      getClassRestriction: vi.fn(async () => ({ restriction: "model" })),
      getClassNames: vi.fn(async () => ({ classNames: members })),
    };
  }

  it("keeps a package's members in the order OMC reports them", async () => {
    const client = packageClient(["Resistor", "Capacitor"]);
    const source = new LibrarySource(client);

    const rows = await source.listChildren("P");

    expect(rows.map((r) => r.qualified)).toEqual(["P.Resistor", "P.Capacitor"]);
    // `sort` would replace the author's `package.order` with alphabetical.
    expect(client.getClassNames).toHaveBeenCalledWith({ typeName: "P" });
  });

  it("sorts the roots, which have no authored order", async () => {
    const client = packageClient(["Modelica"]);
    const source = new LibrarySource(client);

    await source.listChildren(null);

    expect(client.getClassNames).toHaveBeenCalledWith({ sort: true });
  });
});
