/**
 * Correlation integrity of the postMessage bridge. The sidebar view keeps ONE
 * `WebviewLibraryDataSource` for its lifetime and re-fetches on the same
 * instance across reloads; the earlier bug swapped in a fresh source per reload,
 * which restarted request ids so a response for an in-flight request landed on
 * the wrong instance and the tree hung on "Loading…". These pin that a reused
 * source still resolves its in-flight request, that instances mint distinct
 * ids, and that a foreign id is ignored rather than wrongly matched.
 */

import { describe, expect, it } from "vitest";
import type { LibraryClassInfo } from "@dicode/diagram-ui";

import {
  WebviewLibraryDataSource,
  type LibraryRequestMessage,
} from "./library-data-source.js";

const item = (qualified: string): LibraryClassInfo => ({
  qualified,
  restriction: "model",
});

/** Settled-state probe that doesn't itself resolve the promise under test. */
async function isSettled(p: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void p.then(
    () => (settled = true),
    () => (settled = true),
  );
  await Promise.resolve();
  await Promise.resolve();
  return settled;
}

describe("WebviewLibraryDataSource", () => {
  it("resolves a request issued before a reload when the same source is reused", async () => {
    const posted: LibraryRequestMessage[] = [];
    const source = new WebviewLibraryDataSource((m) => posted.push(m));

    const pending = source.listChildren(null);
    const req = posted.at(-1);
    if (req?.type !== "libraryListChildren") throw new Error("no request");

    // A reload reuses this same instance; the original request's response
    // arrives afterwards and must still resolve it.
    source.handleResponse({
      requestId: req.requestId,
      items: [item("Modelica")],
    });
    await expect(pending).resolves.toEqual([item("Modelica")]);
  });

  it("mints distinct request ids per instance so responses can't cross-match", () => {
    const a: LibraryRequestMessage[] = [];
    const b: LibraryRequestMessage[] = [];
    const sourceA = new WebviewLibraryDataSource((m) => a.push(m));
    const sourceB = new WebviewLibraryDataSource((m) => b.push(m));

    void sourceA.listChildren(null);
    void sourceB.listChildren(null);

    expect(a.at(-1)?.requestId).toBeDefined();
    expect(a.at(-1)?.requestId).not.toBe(b.at(-1)?.requestId);
  });

  it("ignores a response for a foreign request id, then resolves on the real one", async () => {
    const posted: LibraryRequestMessage[] = [];
    const source = new WebviewLibraryDataSource((m) => posted.push(m));

    const pending = source.listChildren(null);
    const req = posted.at(-1);
    if (req?.type !== "libraryListChildren") throw new Error("no request");

    source.handleResponse({ requestId: "lib99-1", items: [item("Wrong")] });
    expect(await isSettled(pending)).toBe(false);

    source.handleResponse({ requestId: req.requestId, items: [item("Right")] });
    await expect(pending).resolves.toEqual([item("Right")]);
  });
});
