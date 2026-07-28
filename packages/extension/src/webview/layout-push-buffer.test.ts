/**
 * The webview half of issue #404. The controller diffs an edit against the
 * layout whose revision the edit names, so the revision the webview reports
 * has to be the one it is actually showing — never one it was sent but held,
 * and never one it was sent but skipped.
 */

import { describe, expect, it } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import { LayoutPushBuffer, type LayoutPush } from "./layout-push-buffer.js";

function push(revision: number): LayoutPush {
  return {
    type: "layout",
    revision,
    layout: { className: `r${revision}` } as unknown as DiagramLayout,
  };
}

describe("LayoutPushBuffer", () => {
  it("applies a push when no gesture is in flight and adopts its revision", () => {
    const buffer = new LayoutPushBuffer();
    expect(buffer.revision).toBe(0);

    expect(buffer.receive(push(1), false)).toEqual(push(1));
    expect(buffer.revision).toBe(1);
    expect(buffer.hasHeld).toBe(false);
  });

  it("holds a push arriving mid-gesture, leaving the reported revision alone", () => {
    const buffer = new LayoutPushBuffer();
    buffer.receive(push(1), false);

    expect(buffer.receive(push(2), true)).toBeNull();
    // An edit committed now is derived from revision 1, and must say so.
    expect(buffer.revision).toBe(1);
    expect(buffer.hasHeld).toBe(true);

    expect(buffer.release()).toEqual(push(2));
    expect(buffer.revision).toBe(2);
    expect(buffer.hasHeld).toBe(false);
  });

  it("keeps only the newest of several pushes held during one gesture", () => {
    const buffer = new LayoutPushBuffer();
    buffer.receive(push(1), true);
    buffer.receive(push(2), true);
    buffer.receive(push(3), true);

    expect(buffer.release()).toEqual(push(3));
    expect(buffer.revision).toBe(3);
  });

  it("drops a held push when one lands outside the gesture, rather than applying it after", () => {
    const buffer = new LayoutPushBuffer();
    buffer.receive(push(2), true);

    expect(buffer.receive(push(3), false)).toEqual(push(3));
    expect(buffer.hasHeld).toBe(false);
    expect(buffer.release()).toBeNull();
    expect(buffer.revision).toBe(3);
  });

  it("releases nothing when nothing was held", () => {
    const buffer = new LayoutPushBuffer();
    buffer.receive(push(1), false);

    expect(buffer.release()).toBeNull();
    expect(buffer.revision).toBe(1);
  });

  it("lets an init supersede a held push", () => {
    const buffer = new LayoutPushBuffer();
    buffer.receive(push(4), true);

    buffer.reset(0);
    expect(buffer.revision).toBe(0);
    expect(buffer.hasHeld).toBe(false);
    expect(buffer.release()).toBeNull();
  });
});
