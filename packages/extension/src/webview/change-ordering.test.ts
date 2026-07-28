/**
 * Ordering around the webview's commit debounce (issue #404). A queued commit
 * that a paste or a parameter submit overtakes would have the host reading the
 * class as it stood before the gesture the user already made.
 */

import { describe, expect, it } from "vitest";

import {
  canApplyLayoutPush,
  mustFollowQueuedChange,
} from "./change-ordering.js";
import type { WebviewToExtension } from "./protocol.js";

describe("canApplyLayoutPush", () => {
  it("applies a push when the webview is holding nothing back", () => {
    expect(
      canApplyLayoutPush({ gestureActive: false, hasQueuedChange: false }),
    ).toBe(true);
  });

  it("refuses one during a gesture, which has committed nothing yet", () => {
    expect(
      canApplyLayoutPush({ gestureActive: true, hasQueuedChange: false }),
    ).toBe(false);
  });

  it("refuses one while a commit is still inside the debounce", () => {
    // The host settles on its own queue draining, which cannot see a commit
    // the webview has not sent yet — so this push predates what is on screen,
    // and applying it puts the user's edit back undone.
    expect(
      canApplyLayoutPush({ gestureActive: false, hasQueuedChange: true }),
    ).toBe(false);
  });
});

describe("mustFollowQueuedChange", () => {
  it("lets selection and focus overtake a queued commit", () => {
    // A drag reports its selection on press and its commit on release, so
    // flushing here would coalesce nothing.
    expect(mustFollowQueuedChange("selectionChange")).toBe(false);
    expect(mustFollowQueuedChange("inputFocus")).toBe(false);
    expect(mustFollowQueuedChange("ready")).toBe(false);
  });

  it("holds every message that reads or writes the class behind it", () => {
    const modelAffecting: Array<WebviewToExtension["type"]> = [
      "paste",
      "copySelection",
      "addComponent",
      "connectionCreate",
      "parametersSubmit",
      "resetComponentParameters",
      "changeClassRequest",
      "editComponent",
      "actionCheck",
      "actionSimulate",
    ];
    for (const type of modelAffecting) {
      expect(mustFollowQueuedChange(type), type).toBe(true);
    }
  });

  it("orders an unrecognised message conservatively", () => {
    // A message type added later has to be opted out deliberately, not by
    // being forgotten.
    expect(
      mustFollowQueuedChange(
        "somethingAddedLater" as WebviewToExtension["type"],
      ),
    ).toBe(true);
  });
});
