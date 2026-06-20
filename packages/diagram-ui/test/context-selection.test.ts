import { describe, expect, it } from "vitest";

import { nextContextSelection } from "../src/context-menu/context-selection.js";

describe("nextContextSelection", () => {
  it("selects an unselected entity", () => {
    expect(nextContextSelection(new Set(["c:a"]), "c:b")).toEqual(["c:b"]);
    expect(nextContextSelection(new Set(), "c:a")).toEqual(["c:a"]);
  });

  it("keeps the selection when the clicked entity is already selected", () => {
    expect(nextContextSelection(new Set(["c:a", "c:b"]), "c:a")).toBeNull();
  });

  it("clears a non-empty selection on an empty-space click", () => {
    expect(nextContextSelection(new Set(["c:a"]), null)).toEqual([]);
  });

  it("is a no-op on an empty-space click with nothing selected", () => {
    expect(nextContextSelection(new Set(), null)).toBeNull();
  });
});
