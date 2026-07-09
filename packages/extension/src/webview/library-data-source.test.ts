/**
 * Correlation integrity of the postMessage bridge. A source must resolve a
 * request that resolves after it is reused across a reload, mint request ids
 * distinct from any other instance, and ignore a foreign id rather than
 * matching it against the wrong pending request. Together these guarantee a
 * reload can't orphan an in-flight request and hang the tree on "Loading…".
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
