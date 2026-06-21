/**
 * Interaction state machine for `<om-graphical-layout>`. Models the
 * single "what is the user currently doing" question across the
 * cursor / drag pipeline — the fine-grained gesture states plus a
 * passive `hovering`:
 *
 *   idle       — no entity under the pointer, nothing in flight
 *   hovering   — pointer over an entity, no drag yet
 *   moving     — move drag in progress (one or more entities)
 *   resizing   — resize drag on a single entity's corner
 *   rotating   — rotate drag from a shape's rotate handle
 *   selecting  — rubber-band selection drag (empty-space drag)
 *   connecting — connection drag from a connector port
 *   drawing    — extent-drag drawing a new primitive
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
  | { kind: "rotating"; key: string }
  | { kind: "selecting" }
  | { kind: "drawing" }
  | {
      kind: "connecting";
      fromKey: string;
      toKey: string | null;
    };

/**
 * Interaction state — what the user is currently doing. `idle` is the
 * resting state; a `pointerdown` transitions into the matching gesture
 * (`select` rubber-band, `drag` move/resize/rotate/edge, `connect`
 * routing) and `pointerup` returns to `idle`. Drawing tools extend this
 * set with sticky resting states.
 */
export type ModeId = "idle" | "select" | "drag" | "connect" | "draw";

export interface InteractionSnapshot {
  state: InteractionState;
  /** Coarse interaction mode set by the router on each gesture: the
   *  press-drag family (`select`/`drag`/`connect`) or `idle` at rest.
   *  `state` carries the finer gesture detail (which keys, which corner). */
  mode: ModeId;
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
  mode: "idle",
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
      mode: patch.mode ?? this.snapshot.mode,
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
