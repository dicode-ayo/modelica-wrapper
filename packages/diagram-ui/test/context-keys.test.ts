import { describe, expect, it } from "vitest";

import { deriveContextKeys } from "../src/interaction/context-keys.js";
import type { InteractionSnapshot } from "../src/interaction/interaction-state.js";

function snap(partial: Partial<InteractionSnapshot>): InteractionSnapshot {
  return {
    state: { kind: "idle" },
    mode: "select",
    hoverKey: null,
    selectedKeys: [],
    version: 0,
    ...partial,
  };
}

const env = {
  readonly: false,
  viewLayer: "diagram" as const,
  hasClipboard: false,
  vertexTarget: false,
  polySelection: false,
  hasDefinitionSource: false,
  hasDeclarationSource: false,
};

describe("deriveContextKeys", () => {
  it("reports none for an empty selection", () => {
    expect(deriveContextKeys(snap({}), env)).toMatchObject({
      mode: "select",
      gesture: "idle",
      selectionKind: "none",
      selectionCount: 0,
    });
  });

  it("reports the homogeneous selection kind", () => {
    const ctx = deriveContextKeys(
      snap({ selectedKeys: ["c:R1", "c:C1"] }),
      env,
    );
    expect(ctx.selectionKind).toBe("component");
    expect(ctx.selectionCount).toBe(2);
  });

  it("reports mixed for a heterogeneous selection", () => {
    const ctx = deriveContextKeys(
      snap({ selectedKeys: ["c:R1", "edge:0"] }),
      env,
    );
    expect(ctx.selectionKind).toBe("mixed");
  });

  it("ignores unparseable keys when deriving the kind", () => {
    const ctx = deriveContextKeys(
      snap({ selectedKeys: ["bogus", "c:R1"] }),
      env,
    );
    expect(ctx.selectionKind).toBe("component");
  });

  it("passes through mode, gesture, and env", () => {
    const ctx = deriveContextKeys(
      snap({
        mode: "connect",
        state: { kind: "connecting", fromKey: "k:p", toKey: null },
      }),
      {
        readonly: true,
        viewLayer: "icon",
        hasClipboard: true,
        vertexTarget: false,
        polySelection: false,
        hasDefinitionSource: false,
        hasDeclarationSource: false,
      },
    );
    expect(ctx).toMatchObject({
      mode: "connect",
      gesture: "connecting",
      readonly: true,
      viewLayer: "icon",
      hasClipboard: true,
    });
  });
});
