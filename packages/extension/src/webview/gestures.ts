/**
 * Every gesture the diagram webview can send the host, declared once.
 *
 * A gesture is four things: a name, a payload, how it orders against a queued
 * layout commit, and whether the icon editor acts on it. Declaring them apart
 * is what let a gesture reach the host and do nothing — the ordering set and
 * the icon-mode filter both answered by omission, and the dispatch switch had a
 * `default` arm to fall into. Here the four sit in one entry, all required, and
 * {@link WebviewToExtension} is derived from the table rather than written
 * beside it: a gesture that exists is a gesture that has answered all four.
 *
 * Consumers:
 *   - `webview-entry.ts` posts `WebviewToExtension` values,
 *   - `commit-slot.ts` reads {@link gestureOrdering},
 *   - `diagram-editor-provider.ts` validates with {@link isGestureMessage},
 *     filters icon mode with {@link iconHonorsGesture}, and dispatches over the
 *     union with `assertUnreachable` at the end.
 */

import { assertUnreachable } from "@dicode/modelica-lang-core";
import type { DiagramLayout } from "@dicode/omc-client";

/**
 * Which parameter modal the panel is showing. `classParams`, `componentParams`,
 * and `shapeProperties` write back to the class source; `simulate` runs the
 * model and emits a result file without touching source, so it stays usable on
 * a read-only class.
 */
export type ParameterFormKind =
  | "classParams"
  | "componentParams"
  | "shapeProperties"
  | "simulate";

/**
 * Whether a queued layout commit has to reach the host before this gesture
 * does. A commit is debounced in the webview ({@link CommitSlot}), so anything
 * that reads or writes the class would otherwise see it as it stood a gesture
 * ago.
 */
export type GestureOrdering =
  /**
   * Says nothing about the model, so a queued commit may stay queued behind it
   * — and must, for `selectionChange`: a drag reports its selection on press
   * and its commit on release, so flushing on selection would end the
   * coalescing before it starts.
   */
  | "uiOnly"
  /** Reads or writes the class, so it cannot overtake a queued commit. */
  | "afterCommit";

/**
 * Whether the icon editor acts on this gesture. It edits the class's own icon
 * annotation, so shape work and connector placement are its business and the
 * rest of the diagram's gestures are not.
 *
 * `shapeFormOnly` is a policy rather than a payload predicate because the
 * parameter modal messages carry the form they belong to: the icon editor opens
 * the shape-properties form and no other, so a submit naming a different form
 * is not a form it put on screen.
 */
export type IconPolicy = "honored" | "ignored" | "shapeFormOnly";

/** Narrows one field of an unvalidated payload. */
type FieldCheck<T> = (value: unknown) => value is T;

type FieldChecks = Readonly<Record<string, FieldCheck<unknown>>>;

/** The payload a set of field checks describes once they all pass. */
type PayloadOf<F extends FieldChecks> = {
  [K in keyof F]: F[K] extends FieldCheck<infer T> ? T : never;
};

interface GestureSpec<F extends FieldChecks> {
  readonly payload: F;
  readonly ordering: GestureOrdering;
  readonly icon: IconPolicy;
}

/**
 * Declare one gesture. Every facet is required, so a gesture cannot be added
 * without answering all of them, and `F` is inferred from `payload` so the
 * message type comes from the checks that guard it rather than a second
 * declaration that has to agree with them.
 */
function gesture<F extends FieldChecks>(spec: GestureSpec<F>): GestureSpec<F> {
  return spec;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number"
  );
}

function isWaypoints(
  value: unknown,
): value is ReadonlyArray<readonly [number, number]> {
  return (
    Array.isArray(value) &&
    value.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((coord) => typeof coord === "number"),
    )
  );
}

/**
 * Structural, not exhaustive: a layout's interior is compared field by field
 * against a freshly-read one before anything is written (`applyDiagramEdits`),
 * so a malformed one diffs to edits OMC rejects rather than to a silent write.
 * What this rules out is a payload that is not a layout at all reaching that
 * diff.
 */
function isDiagramLayout(value: unknown): value is DiagramLayout {
  return (
    isRecord(value) &&
    typeof value.className === "string" &&
    (value.kind === "icon" || value.kind === "diagram")
  );
}

function isParameterFormKind(value: unknown): value is ParameterFormKind {
  return (
    value === "classParams" ||
    value === "componentParams" ||
    value === "shapeProperties" ||
    value === "simulate"
  );
}

/**
 * Form values stay `unknown` per field: the form renders whatever the
 * `ParameterModel` describes, and each submit path coerces against the model it
 * built. Only the envelope is checked here.
 */
function isFormValues(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

const noPayload = {} as const;

export const GESTURES = {
  /** Webview has finished loading; the host releases the parked `init`. */
  ready: gesture({ payload: noPayload, ordering: "uiOnly", icon: "ignored" }),

  /** User committed a layout change — the whole layout, not a diff. */
  change: gesture({
    payload: { layout: isDiagramLayout },
    ordering: "afterCommit",
    icon: "honored",
  }),

  /** User dragged from one connector to another. Empty waypoints ⇒ auto-route. */
  connectionCreate: gesture({
    payload: { fromKey: isString, toKey: isString, waypoints: isWaypoints },
    ordering: "afterCommit",
    icon: "ignored",
  }),

  /** Selection set updated, in canonical entity-key form. */
  selectionChange: gesture({
    payload: { keys: isStringArray },
    ordering: "uiOnly",
    icon: "ignored",
  }),

  /**
   * Whether keyboard focus sits in an editable field inside the webview. Drives
   * the `modelicaDiagramInputFocus` context key so the diagram's single-letter
   * keybindings (r/f/Delete) don't fire while typing.
   */
  inputFocus: gesture({
    payload: { focused: isBoolean },
    ordering: "uiOnly",
    icon: "ignored",
  }),

  /** Toolbar Check Model. */
  actionCheck: gesture({
    payload: noPayload,
    ordering: "afterCommit",
    icon: "ignored",
  }),

  /** Toolbar Simulate. */
  actionSimulate: gesture({
    payload: noPayload,
    ordering: "afterCommit",
    icon: "ignored",
  }),

  /** Toolbar class-level Parameters. */
  actionParameters: gesture({
    payload: noPayload,
    ordering: "afterCommit",
    icon: "ignored",
  }),

  /** Double-click on a sub-component — open its parameter modal. */
  editComponent: gesture({
    payload: { componentName: isString },
    ordering: "afterCommit",
    icon: "ignored",
  }),

  /**
   * Double-click on a shape — open its properties modal. Selecting one does
   * not: a modal opening on selection interrupts every pick.
   */
  editShape: gesture({
    payload: { key: isString },
    ordering: "afterCommit",
    icon: "honored",
  }),

  /** Parameter modal Apply/Run. */
  parametersSubmit: gesture({
    payload: { kind: isParameterFormKind, values: isFormValues },
    ordering: "afterCommit",
    icon: "shapeFormOnly",
  }),

  /** Parameter modal dismissed. */
  parametersCancel: gesture({
    payload: { kind: isParameterFormKind },
    ordering: "afterCommit",
    icon: "shapeFormOnly",
  }),

  /**
   * "Reset to defaults" in the component modal. The host bulk-clears the
   * sub-component's modifiers and re-opens the refreshed form.
   */
  resetComponentParameters: gesture({
    payload: { componentName: isString },
    ordering: "afterCommit",
    icon: "ignored",
  }),

  /**
   * A class was dropped or placed on the canvas; instantiate it into the active
   * diagram at `position`. Restriction-gated host-side, which is what lets the
   * icon editor honor it — only a connector gets through there.
   */
  addComponent: gesture({
    payload: { className: isString, position: isPoint },
    ordering: "afterCommit",
    icon: "honored",
  }),

  /** User asked to swap a sub-component's type. */
  changeClassRequest: gesture({
    payload: { componentName: isString, currentClass: isString },
    ordering: "afterCommit",
    icon: "ignored",
  }),

  /**
   * Clipboard commands. The host owns the clipboard — it is window-wide — so
   * the webview reports the gesture and lets the host resolve the keys against
   * the layout.
   */
  copySelection: gesture({
    payload: { keys: isStringArray },
    ordering: "afterCommit",
    icon: "honored",
  }),

  paste: gesture({
    payload: noPayload,
    ordering: "afterCommit",
    icon: "honored",
  }),
};

type GestureTable = typeof GESTURES;

export type GestureName = keyof GestureTable & string;

/**
 * The webview → host message union, derived from {@link GESTURES}. There is no
 * second place to add a variant, so there is no second place to forget one.
 */
export type WebviewToExtension = {
  [K in GestureName]: { type: K } & PayloadOf<GestureTable[K]["payload"]>;
}[GestureName];

function isGestureName(value: unknown): value is GestureName {
  return typeof value === "string" && Object.hasOwn(GESTURES, value);
}

/** Every declared gesture, in declaration order. */
export function gestureNames(): GestureName[] {
  return Object.keys(GESTURES).filter(isGestureName);
}

/**
 * Validate a raw `postMessage` payload against its declaration. This is the one
 * place an inbound message stops being `unknown`; everything downstream works
 * on the narrowed union.
 *
 * `onReject` is required rather than optional because a dropped message that
 * nobody reports is the failure this whole module exists to remove.
 */
export function isGestureMessage(
  value: unknown,
  onReject: (reason: string) => void,
): value is WebviewToExtension {
  if (!isRecord(value)) {
    onReject("payload is not an object");
    return false;
  }
  const { type } = value;
  if (!isGestureName(type)) {
    onReject(`unknown gesture ${JSON.stringify(type)}`);
    return false;
  }
  for (const [field, check] of Object.entries(GESTURES[type].payload)) {
    if (!check(value[field])) {
      onReject(`${type}.${field} has the wrong shape`);
      return false;
    }
  }
  return true;
}

/** How `type` orders against a queued layout commit. */
export function gestureOrdering(
  type: WebviewToExtension["type"],
): GestureOrdering {
  return GESTURES[type].ordering;
}

/** Whether the icon editor acts on `message`. */
export function iconHonorsGesture(message: WebviewToExtension): boolean {
  const policy = GESTURES[message.type].icon;
  switch (policy) {
    case "honored":
      return true;
    case "ignored":
      return false;
    case "shapeFormOnly":
      return "kind" in message && message.kind === "shapeProperties";
    default:
      return assertUnreachable(policy, "IconPolicy");
  }
}
