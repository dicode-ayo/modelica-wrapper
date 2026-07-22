import { describe, expect, it } from "vitest";

import { panelReadonly } from "./panel-readonly.js";

describe("panelReadonly", () => {
  it("keeps every form editable on a writable class", () => {
    expect(panelReadonly(false, "classParams")).toBe(false);
    expect(panelReadonly(false, "simulate")).toBe(false);
    expect(panelReadonly(false, null)).toBe(false);
  });

  it("locks the source-mutating forms on a read-only class", () => {
    expect(panelReadonly(true, "classParams")).toBe(true);
    expect(panelReadonly(true, "componentParams")).toBe(true);
    expect(panelReadonly(true, "shapeProperties")).toBe(true);
  });

  it("leaves the simulate form usable on a read-only class", () => {
    expect(panelReadonly(true, "simulate")).toBe(false);
  });
});
