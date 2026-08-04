/**
 * The webview half of issue #404: what may happen between the diagram
 * committing an edit and the host hearing about it. The host settles on its own
 * queue draining, which cannot see a commit still held here — so a push raised
 * in that window predates the screen, and applying it undoes the user's edit
 * until the settle for their own commit arrives.
 */

import { describe, expect, it, vi } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import { CommitSlot, type CommitScheduler } from "./commit-slot.js";
import type { WebviewToExtension } from "./protocol.js";

function layout(name: string): DiagramLayout {
  return { className: name } as unknown as DiagramLayout;
}

/** A scheduler whose single pending callback the test fires via `fire`. */
function manualScheduler(): {
  scheduler: CommitScheduler;
  fire: () => void;
  armed: () => boolean;
} {
  let pending: (() => void) | undefined;
  return {
    scheduler: {
      schedule(fn) {
        pending = fn;
        return {
          cancel: () => {
            if (pending === fn) pending = undefined;
          },
        };
      },
    },
    fire: () => {
      const fn = pending;
      pending = undefined;
      fn?.();
    },
    armed: () => pending !== undefined,
  };
}

function makeSlot(): {
  slot: CommitSlot;
  sent: DiagramLayout[];
  fire: () => void;
  armed: () => boolean;
} {
  const sent: DiagramLayout[] = [];
  const { scheduler, fire, armed } = manualScheduler();
  return {
    slot: new CommitSlot((l) => sent.push(l), scheduler),
    sent,
    fire,
    armed,
  };
}

describe("CommitSlot", () => {
  it("collapses a burst of commits into one report", () => {
    const { slot, sent, fire } = makeSlot();

    slot.commit(layout("a"));
    slot.commit(layout("b"));
    slot.commit(layout("c"));
    expect(sent).toEqual([]);

    fire();
    // Each commit carries the whole layout, so the last one says everything
    // its predecessors did.
    expect(sent).toEqual([layout("c")]);
  });

  it("refuses a push while a commit is held, and allows one once it is sent", () => {
    const { slot, fire } = makeSlot();
    expect(slot.canApplyPush(false)).toBe(true);

    slot.commit(layout("a"));
    expect(slot.canApplyPush(false)).toBe(false);

    fire();
    expect(slot.canApplyPush(false)).toBe(true);
  });

  it("refuses a push during a gesture, which has committed nothing yet", () => {
    const { slot } = makeSlot();
    expect(slot.canApplyPush(true)).toBe(false);
  });

  it("sends a held commit ahead of a message that reads the class", () => {
    const { slot, sent } = makeSlot();
    slot.commit(layout("a"));

    // Reaching the host first, a paste would be resolved against the diagram
    // as it stood before the gesture — and its own additions then read as
    // deletions when the commit finally landed.
    slot.beforeSending("paste");
    expect(sent).toEqual([layout("a")]);
  });

  it("lets selection and focus overtake a held commit", () => {
    const { slot, sent } = makeSlot();
    slot.commit(layout("a"));

    slot.beforeSending("selectionChange");
    slot.beforeSending("inputFocus");
    // A drag reports its selection on press and its commit on release, so
    // flushing on selection would coalesce nothing.
    expect(sent).toEqual([]);
  });

  it("flushes on demand, and disarms the debounce so it cannot send twice", () => {
    const { slot, sent, fire, armed } = makeSlot();
    slot.commit(layout("a"));

    slot.flush();
    expect(sent).toEqual([layout("a")]);
    expect(armed()).toBe(false);

    fire();
    expect(sent).toEqual([layout("a")]);
  });

  it("does nothing when asked to flush with nothing held", () => {
    const { slot, sent } = makeSlot();
    slot.flush();
    expect(sent).toEqual([]);
  });

  it("drives the real timer when no scheduler is injected", () => {
    vi.useFakeTimers();
    try {
      const sent: DiagramLayout[] = [];
      const slot = new CommitSlot((l) => sent.push(l));
      slot.commit(layout("a"));
      expect(sent).toEqual([]);

      vi.advanceTimersByTime(1000);
      expect(sent).toEqual([layout("a")]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CommitSlot ordering", () => {
  it("holds every message that reads or writes the class behind a commit", () => {
    const modelAffecting: Array<WebviewToExtension["type"]> = [
      "paste",
      "copySelection",
      "addComponent",
      "connectionCreate",
      "parametersSubmit",
      "resetComponentParameters",
      "changeClassRequest",
      "editComponent",
      "editShape",
      "actionCheck",
      "actionSimulate",
    ];
    for (const type of modelAffecting) {
      const { slot, sent } = makeSlot();
      slot.commit(layout("a"));
      slot.beforeSending(type);
      expect(sent, type).toEqual([layout("a")]);
    }
  });

  it("orders an unrecognised message conservatively", () => {
    // A message type added later has to be opted out deliberately, not by
    // being forgotten.
    const { slot, sent } = makeSlot();
    slot.commit(layout("a"));
    slot.beforeSending("somethingAddedLater" as WebviewToExtension["type"]);
    expect(sent).toEqual([layout("a")]);
  });
});
