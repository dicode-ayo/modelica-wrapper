/**
 * The gesture declaration is the seam's single source of truth, so these pin
 * what "declared once" has to buy: an inbound message is validated against the
 * declaration before anything downstream sees it, and the ordering and
 * icon-mode answers come from the same entry that names the gesture.
 *
 * The compile-time half — a gesture that omits its ordering or icon policy, or
 * a `WebviewToExtension` variant with no entry — is enforced by the gesture
 * table's own types and cannot be expressed here.
 */

import { describe, expect, it, vi } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import {
  gestureNames,
  iconHonorsGesture,
  isGestureMessage,
  type WebviewToExtension,
} from "./gestures.js";

function layout(): DiagramLayout {
  return { kind: "diagram", className: "A" } as unknown as DiagramLayout;
}

/** One well-formed message per declared gesture. */
const SAMPLES: WebviewToExtension[] = [
  { type: "ready" },
  { type: "change", layout: layout(), basedOn: 1 },
  {
    type: "connectionCreate",
    fromKey: "a",
    toKey: "b",
    waypoints: [[0, 0]],
  },
  { type: "selectionChange", keys: ["a"] },
  { type: "inputFocus", focused: true },
  { type: "actionCheck" },
  { type: "actionSimulate" },
  { type: "actionParameters" },
  { type: "editComponent", componentName: "r1" },
  { type: "editShape", key: "shape:line:0" },
  {
    type: "parametersSubmit",
    kind: "classParams",
    values: { R: 1 },
    dirty: ["R"],
  },
  { type: "parametersCancel", kind: "simulate" },
  { type: "resetComponentParameters", componentName: "r1" },
  { type: "addComponent", className: "A.B", position: { x: 1, y: 2 } },
  { type: "changeClassRequest", componentName: "r1", currentClass: "A" },
  { type: "copySelection", keys: ["a"] },
  { type: "paste" },
];

describe("isGestureMessage", () => {
  it("accepts every declared gesture's own shape", () => {
    // A field check that can never pass would disable its gesture at the
    // boundary. The name comparison keeps this walking the whole table as it
    // grows.
    const reject = vi.fn();
    expect(SAMPLES.map((sample) => sample.type).sort()).toEqual(
      gestureNames().sort(),
    );
    for (const sample of SAMPLES) {
      expect(isGestureMessage(sample, reject), sample.type).toBe(true);
    }
    expect(reject).not.toHaveBeenCalled();
  });

  it("rejects an unknown type, naming it", () => {
    const reject = vi.fn();
    expect(isGestureMessage({ type: "somethingAddedLater" }, reject)).toBe(
      false,
    );
    expect(reject).toHaveBeenCalledWith(
      expect.stringContaining("somethingAddedLater"),
    );
  });

  it("rejects a payload that is not an object", () => {
    const reject = vi.fn();
    expect(isGestureMessage("change", reject)).toBe(false);
    expect(isGestureMessage(null, reject)).toBe(false);
    expect(reject).toHaveBeenCalledTimes(2);
  });

  it("rejects a known type whose field is the wrong shape, naming the field", () => {
    const reject = vi.fn();
    expect(
      isGestureMessage({ type: "selectionChange", keys: "r1" }, reject),
    ).toBe(false);
    expect(reject).toHaveBeenCalledWith(
      expect.stringContaining("selectionChange.keys"),
    );
  });

  it("rejects a parametersSubmit whose dirty is not a string array", () => {
    const reject = vi.fn();
    const raw = {
      type: "parametersSubmit",
      kind: "classParams",
      values: {},
      dirty: "R",
    };
    expect(isGestureMessage(raw, reject)).toBe(false);
    expect(reject).toHaveBeenCalledWith(
      expect.stringContaining("parametersSubmit.dirty"),
    );
  });

  it("rejects a misspelled form kind at the boundary, not by dropping the write", () => {
    const reject = vi.fn();
    const raw = {
      type: "parametersSubmit",
      kind: "classParams ",
      values: {},
      dirty: [],
    };
    expect(isGestureMessage(raw, reject)).toBe(false);
    expect(reject).toHaveBeenCalledWith(
      expect.stringContaining("parametersSubmit.kind"),
    );
  });

  it("rejects a change whose layout is not one", () => {
    const reject = vi.fn();
    expect(
      isGestureMessage(
        { type: "change", layout: { kind: "x" }, basedOn: 1 },
        reject,
      ),
    ).toBe(false);
  });

  it("rejects a change whose basedOn is not a finite number", () => {
    const reject = vi.fn();
    expect(
      isGestureMessage(
        { type: "change", layout: layout(), basedOn: "1" },
        reject,
      ),
    ).toBe(false);
    expect(
      isGestureMessage(
        { type: "change", layout: layout(), basedOn: NaN },
        reject,
      ),
    ).toBe(false);
    expect(reject).toHaveBeenCalledWith(
      expect.stringContaining("change.basedOn"),
    );
  });
});

describe("iconHonorsGesture", () => {
  it("honors shape work, connector placement and the clipboard", () => {
    expect(
      iconHonorsGesture({ type: "change", layout: layout(), basedOn: 1 }),
    ).toBe(true);
    expect(iconHonorsGesture({ type: "editShape", key: "shape:line:0" })).toBe(
      true,
    );
    expect(
      iconHonorsGesture({
        type: "addComponent",
        className: "A.B",
        position: { x: 0, y: 0 },
      }),
    ).toBe(true);
    expect(iconHonorsGesture({ type: "paste" })).toBe(true);
    expect(iconHonorsGesture({ type: "copySelection", keys: ["a"] })).toBe(
      true,
    );
  });

  it("drops the diagram-only gestures", () => {
    expect(iconHonorsGesture({ type: "actionSimulate" })).toBe(false);
    expect(
      iconHonorsGesture({ type: "editComponent", componentName: "r1" }),
    ).toBe(false);
    expect(
      iconHonorsGesture({
        type: "connectionCreate",
        fromKey: "a",
        toKey: "b",
        waypoints: [],
      }),
    ).toBe(false);
  });

  it("honors a parameter message only while it names the shape form", () => {
    expect(
      iconHonorsGesture({
        type: "parametersSubmit",
        kind: "shapeProperties",
        values: {},
        dirty: [],
      }),
    ).toBe(true);
    expect(
      iconHonorsGesture({
        type: "parametersSubmit",
        kind: "simulate",
        values: {},
        dirty: [],
      }),
    ).toBe(false);
    expect(
      iconHonorsGesture({ type: "parametersCancel", kind: "shapeProperties" }),
    ).toBe(true);
  });
});
