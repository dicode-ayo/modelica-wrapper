/**
 * Interaction state machine for `<om-graphical-layout>`. Models the
 * single "what is the user currently doing" question across the
 * cursor / drag pipeline. Five terminal states mirror the
 * `DragController` kinds plus a passive `hovering`:
 *
 *   idle       — no entity under the pointer, nothing in flight
 *   hovering   — pointer over an entity, no drag yet
 *   moving     — move drag in progress (one or more entities)
 *   resizing   — resize drag on a single entity's corner
 *   selecting  — rubber-band selection drag (empty-space drag)
 *   connecting — connection drag from a connector port
 *
 * The state is *derived* from the same events the host element
 * already handles — we don't introduce a parallel source of truth.
 * `InteractionStateStore` is the behaviour-subject the host pushes
 * to; consumers (HUD, future overlays) subscribe via Lit context.
 */

import { createContext } from "@lit/context";

export type InteractionState =
  | { kind: "idle" }
  | { kind: "hovering"; key: string }
  | { kind: "moving"; keys: readonly string[] }
  | {
      kind: "resizing";
      key: string;
      corner: "tl" | "tr" | "bl" | "br";
    }
  | { kind: "selecting" }
  | {
      kind: "connecting";
      fromKey: string;
      toKey: string | null;
    };

export interface InteractionSnapshot {
  state: InteractionState;
  /** Current hovered entity key, or null. Tracked separately from
   *  `state` because hovering is preempted by any drag — yet the
   *  HUD wants to keep showing the hovered entity name through it. */
  hoverKey: string | null;
  /** Selection set as a stable array — snapshot-friendly. */
  selectedKeys: readonly string[];
  /** Bumps on every emission so consumers can compare-and-skip. */
  version: number;
}

type Listener = (s: InteractionSnapshot) => void;

const INITIAL: InteractionSnapshot = {
  state: { kind: "idle" },
  hoverKey: null,
  selectedKeys: [],
  version: 0,
};

/**
 * Behaviour-subject store: a fresh subscriber receives the current
 * snapshot immediately, plus every subsequent emission. Mirrors
 * `ViewStateStore` so consumers can compose both the same way.
 */
export class InteractionStateStore {
  private snapshot: InteractionSnapshot = INITIAL;
  private readonly listeners = new Set<Listener>();

  get value(): InteractionSnapshot {
    return this.snapshot;
  }

  next(patch: Partial<Omit<InteractionSnapshot, "version">>): void {
    this.snapshot = {
      state: patch.state ?? this.snapshot.state,
      hoverKey:
        patch.hoverKey !== undefined ? patch.hoverKey : this.snapshot.hoverKey,
      selectedKeys: patch.selectedKeys ?? this.snapshot.selectedKeys,
      version: this.snapshot.version + 1,
    };
    for (const l of this.listeners) {
      l(this.snapshot);
    }
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.snapshot);
    return () => {
      this.listeners.delete(l);
    };
  }
}

export const interactionStateContext =
  createContext<InteractionStateStore | null>(Symbol("om-interaction-state"));
