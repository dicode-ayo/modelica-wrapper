import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";

import { MOVE_KINDS, ownerOfHandle } from "../src/interaction/gesture-mode.js";

describe("MOVE_KINDS", () => {
  it("includes host shapes so a shape pick begins a move-drag", () => {
    expect(MOVE_KINDS.has("shape")).toBe(true);
  });

  it("still excludes connectors (a connector pick starts a connection)", () => {
    expect(MOVE_KINDS.has("connector")).toBe(false);
  });
});

describe("ownerOfHandle", () => {
  it("resolves a handle under a host-shape wrapper to its shape key", () => {
    const wrapper = new Container({ label: "om-shape:rectangle:2" });
    const handle = new Container({ label: "handle.tl" });
    wrapper.addChild(handle);
    expect(ownerOfHandle(handle)).toBe("shape:rectangle:2");
  });

  it("resolves a component handle, unchanged by the shape addition", () => {
    const wrapper = new Container({ label: "om-component:R1" });
    const handle = new Container({ label: "handle.br" });
    wrapper.addChild(handle);
    expect(ownerOfHandle(handle)).toBe("c:R1");
  });

  it("returns null when no owner is in the chain", () => {
    expect(ownerOfHandle(new Container({ label: "plain" }))).toBeNull();
  });
});
