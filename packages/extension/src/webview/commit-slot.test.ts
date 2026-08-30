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
import {
  gestureNames,
  type GestureOrdering,
  type WebviewToExtension,
} from "./gestures.js";

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
  basedOns: number[];
  fire: () => void;
  armed: () => boolean;
} {
  const sent: DiagramLayout[] = [];
  const basedOns: number[] = [];
  const { scheduler, fire, armed } = manualScheduler();
  return {
    slot: new CommitSlot((l, basedOn) => {
      sent.push(l);
      basedOns.push(basedOn);
    }, scheduler),
    sent,
    basedOns,
    fire,
    armed,
  };
}

describe("CommitSlot", () => {
  it("collapses a burst of commits into one report", () => {
    const { slot, sent, fire } = makeSlot();

    slot.commit(layout("a"), 1);
    slot.commit(layout("b"), 1);
    slot.commit(layout("c"), 1);
    expect(sent).toEqual([]);

    fire();
    // Each commit carries the whole layout, so the last one says everything
    // its predecessors did.
    expect(sent).toEqual([layout("c")]);
  });

  it("refuses a push while a commit is held, and allows one once it is sent", () => {
    const { slot, fire } = makeSlot();
    expect(slot.canApplyPush(false)).toBe(true);

    slot.commit(layout("a"), 1);
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
    slot.commit(layout("a"), 1);

    // Reaching the host first, a paste would be resolved against the diagram
    // as it stood before the gesture — and its own additions then read as
    // deletions when the commit finally landed.
    slot.beforeSending("paste");
    expect(sent).toEqual([layout("a")]);
  });

  it("lets selection and focus overtake a held commit", () => {
    const { slot, sent } = makeSlot();
    slot.commit(layout("a"), 1);

    slot.beforeSending("selectionChange");
    slot.beforeSending("inputFocus");
    // A drag reports its selection on press and its commit on release, so
    // flushing on selection would coalesce nothing.
    expect(sent).toEqual([]);
  });

  it("flushes on demand, and disarms the debounce so it cannot send twice", () => {
    const { slot, sent, fire, armed } = makeSlot();
    slot.commit(layout("a"), 1);

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

  it("sends each report with the basedOn its commit named", () => {
    const { slot, basedOns, fire } = makeSlot();
    slot.commit(layout("a"), 1);
    fire();
    slot.commit(layout("b"), 3);
    fire();
    expect(basedOns).toEqual([1, 3]);
  });

  it("carries the superseding commit's basedOn, not the replaced one's", () => {
    // A commit that replaces a held one replaces its base too: the report is
    // one layout computed against one base, never a mix of two commits.
    const { slot, sent, basedOns, fire } = makeSlot();
    slot.commit(layout("a"), 1);
    slot.commit(layout("b"), 2);
    fire();
    expect(sent).toEqual([layout("b")]);
    expect(basedOns).toEqual([2]);
  });

  it("refusing a push records nothing — the basedOn a commit named still rides out", () => {
    // A refused push gets no ack. What tells the host it was missed is that
    // the webview's applied version — and so every later commit's basedOn —
    // never advanced to the refused push's stamp.
    const { slot, basedOns, fire } = makeSlot();
    slot.commit(layout("a"), 1);
    expect(slot.canApplyPush(false)).toBe(false);
    fire();
    expect(basedOns).toEqual([1]);
  });

  it("drives the real timer when no scheduler is injected", () => {
    vi.useFakeTimers();
    try {
      const sent: DiagramLayout[] = [];
      const slot = new CommitSlot((l) => sent.push(l));
      slot.commit(layout("a"), 1);
      expect(sent).toEqual([]);

      vi.advanceTimersByTime(1000);
      expect(sent).toEqual([layout("a")]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CommitSlot ordering", () => {
  /**
   * What each gesture's ordering has to be, written independently of the
   * declaration so a flipped entry fails here instead of agreeing with itself.
   * Exhaustive by its type: a new gesture has to answer this too.
   */
  const EXPECTED: Record<WebviewToExtension["type"], GestureOrdering> = {
    ready: "uiOnly",
    selectionChange: "uiOnly",
    inputFocus: "uiOnly",
    goToSource: "uiOnly",
    change: "afterCommit",
    connectionCreate: "afterCommit",
    actionCheck: "afterCommit",
    actionSimulate: "afterCommit",
    actionParameters: "afterCommit",
    editComponent: "afterCommit",
    editShape: "afterCommit",
    parametersSubmit: "afterCommit",
    parametersCancel: "afterCommit",
    resetComponentParameters: "afterCommit",
    addComponent: "afterCommit",
    changeClassRequest: "afterCommit",
    copySelection: "afterCommit",
    paste: "afterCommit",
  };

  it("holds a queued commit behind exactly the gestures that read or write the class", () => {
    for (const type of gestureNames()) {
      const { slot, sent } = makeSlot();
      slot.commit(layout("a"), 1);
      slot.beforeSending(type);
      expect(sent, type).toEqual(
        EXPECTED[type] === "afterCommit" ? [layout("a")] : [],
      );
    }
  });
});
