/**
 * Unit tests for `fetchIconLayout`'s annotation fallback (issue #76, item 9).
 *
 * The cheap `getModelInstanceAnnotation` path can come back UNUSABLE in two
 * ways: a thrown error, OR valid JSON whose `annotation` is null / has no
 * Icon (the PID_Controller-on-OM-fork case). Both must fall back to the full
 * `getModelInstance`, which carries the inherited icon layers.
 *
 * `open-diagram.ts` imports `vscode`; the extension's vitest config aliases
 * it to a mock, so this runs in plain Node.
 */

import { describe, expect, it, vi } from "vitest";
import type { ModelInstance, OmcClient } from "@dicode/omc-client";

import { fetchIconLayout } from "./open-diagram.js";

/**
 * A minimal instance with a usable Icon annotation. Empty `graphics` but a
 * `coordinateSystem` is enough for the producer to emit an icon layer (a
 * layer is created when graphics OR a coord system is present), so the
 * fixture stays free of hand-crafted record-shape encodings.
 */
const WITH_ICON: ModelInstance = {
  name: "Pkg.HasIcon",
  restriction: "model",
  annotation: {
    Icon: {
      coordinateSystem: { extent: [[-100, -100], [100, 100]] },
      graphics: [],
    },
  },
} as unknown as ModelInstance;

/** An instance whose annotation is null — valid JSON, no Icon to paint. */
const NULL_ANNOTATION: ModelInstance = {
  name: "Pkg.NullAnno",
  restriction: "model",
  annotation: null,
} as unknown as ModelInstance;

function makeClient(handlers: {
  annotation?: () => Promise<{ instance: ModelInstance }>;
  full?: () => Promise<{ instance: ModelInstance }>;
}): { client: OmcClient; calls: string[] } {
  const calls: string[] = [];
  const invoke = vi.fn(async (fn: string) => {
    calls.push(fn);
    if (fn === "getModelInstanceAnnotation") {
      return (
        handlers.annotation?.() ??
        Promise.resolve({ instance: WITH_ICON })
      );
    }
    if (fn === "getModelInstance") {
      return handlers.full?.() ?? Promise.resolve({ instance: WITH_ICON });
    }
    throw new Error(`unexpected invoke: ${fn}`);
  });
  const client = { invoke } as unknown as OmcClient;
  return { client, calls };
}

describe("fetchIconLayout: annotation fallback (issue #76, item 9)", () => {
  it("uses the cheap annotation path when it returns a usable Icon", async () => {
    const { client, calls } = makeClient({
      annotation: async () => ({ instance: WITH_ICON }),
    });
    const layout = await fetchIconLayout(client, "Pkg.HasIcon");
    expect(calls).toEqual(["getModelInstanceAnnotation"]);
    expect(layout.kind).toBe("icon");
    expect(layout.iconLayers.length).toBeGreaterThan(0);
  });

  it("falls back to getModelInstance when the annotation is null (no throw)", async () => {
    const { client, calls } = makeClient({
      annotation: async () => ({ instance: NULL_ANNOTATION }),
      full: async () => ({ instance: WITH_ICON }),
    });
    const layout = await fetchIconLayout(client, "Pkg.NullAnno");
    // Both calls fired: cheap path came back without an Icon, so the full
    // instance was fetched as the fallback.
    expect(calls).toEqual(["getModelInstanceAnnotation", "getModelInstance"]);
    expect(layout.iconLayers.length).toBeGreaterThan(0);
  });

  it("falls back to getModelInstance when the annotation call throws", async () => {
    const { client, calls } = makeClient({
      annotation: async () => {
        throw new Error("filtered call failed");
      },
      full: async () => ({ instance: WITH_ICON }),
    });
    const layout = await fetchIconLayout(client, "Pkg.Broken");
    expect(calls).toEqual(["getModelInstanceAnnotation", "getModelInstance"]);
    expect(layout.iconLayers.length).toBeGreaterThan(0);
  });

  it("counts an Icon inherited from an extends ancestor as usable (no fallback)", async () => {
    const inherited: ModelInstance = {
      name: "Pkg.Derived",
      restriction: "model",
      annotation: null,
      elements: [
        { $kind: "extends", baseClass: WITH_ICON },
      ],
    } as unknown as ModelInstance;
    const { client, calls } = makeClient({
      annotation: async () => ({ instance: inherited }),
    });
    await fetchIconLayout(client, "Pkg.Derived");
    expect(calls).toEqual(["getModelInstanceAnnotation"]);
  });
});
