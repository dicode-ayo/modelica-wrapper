/**
 * `placement-drag` mode on `<om-library-tree>`: a primary-button press on a
 * class row fires `om-library-placement-start { className }` (the sidebar relays
 * it to the diagram) and suppresses the native drag/selection default. Row
 * activation stays a separate gesture. happy-dom doesn't render the virtualized
 * rows, so the row handler is exercised directly.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import "./library-tree.component.js";
import type {
  LibraryPlacementStartDetail,
  OmLibraryTree,
} from "./library-tree.component.js";
import type { LibraryClassRestriction } from "./library-types.js";

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) t();
});

function mount(placementDrag: boolean): OmLibraryTree {
  const el = document.createElement("om-library-tree") as OmLibraryTree;
  el.placementDrag = placementDrag;
  document.body.appendChild(el);
  teardowns.push(() => el.remove());
  return el;
}

type RowHandler = (
  event: PointerEvent,
  className: string,
  restriction: LibraryClassRestriction,
) => void;
function rowPointerDown(el: OmLibraryTree): RowHandler {
  return (
    el as unknown as { onRowPointerDown: RowHandler }
  ).onRowPointerDown.bind(el);
}

function pressEvent(button = 0): PointerEvent {
  const event = new Event("pointerdown", { bubbles: true }) as PointerEvent;
  Object.defineProperty(event, "button", { value: button });
  event.preventDefault = vi.fn();
  return event;
}

describe("<om-library-tree> placement-drag", () => {
  it("fires om-library-placement-start and prevents default on a primary press", () => {
    const el = mount(true);
    const detail = vi.fn();
    el.addEventListener("om-library-placement-start", (e) =>
      detail((e as CustomEvent<LibraryPlacementStartDetail>).detail),
    );
    const event = pressEvent();
    rowPointerDown(el)(event, "Modelica.Blocks.Math.Gain", "block");

    expect(event.preventDefault).toHaveBeenCalled();
    expect(detail).toHaveBeenCalledWith({
      className: "Modelica.Blocks.Math.Gain",
    });
  });

  it("does nothing when placement-drag is off", () => {
    const el = mount(false);
    const fired = vi.fn();
    el.addEventListener("om-library-placement-start", fired);
    const event = pressEvent();
    rowPointerDown(el)(event, "A", "block");

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(fired).not.toHaveBeenCalled();
  });

  it("ignores non-primary buttons, empty class names, and non-placeable rows", () => {
    const el = mount(true);
    const fired = vi.fn();
    el.addEventListener("om-library-placement-start", fired);

    rowPointerDown(el)(pressEvent(2), "A", "block");
    rowPointerDown(el)(pressEvent(0), "", "block");
    // A package can't be instantiated — a primary press must not arm placement.
    rowPointerDown(el)(pressEvent(0), "Modelica.Blocks", "package");

    expect(fired).not.toHaveBeenCalled();
  });
});
