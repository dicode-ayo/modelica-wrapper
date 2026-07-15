/**
 * `fetchIconLayout` resolves an icon from the cheap filtered annotation call and
 * only instantiates the class when that call fails to answer at all. A class
 * that merely has no Icon must not be instantiated: OMC never returns for the
 * builtins, and a deep hierarchy costs seconds on a channel every other call
 * shares.
 *
 * `open-diagram.ts` imports `vscode`; the extension's vitest config aliases
 * it to a mock, so this runs in plain Node.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelInstance, OmcClient } from "@dicode/omc-client";

import { executedCommands } from "../../test-support/vscode-mock.js";
import {
  fetchIconLayout,
  guardAddComponent,
  openDiagram,
  type PartialCheckClient,
} from "./open-diagram.js";

describe("openDiagram", () => {
  beforeEach(() => {
    executedCommands.length = 0;
  });

  it("opens the class in the modelica.diagram custom editor via openWith", async () => {
    await openDiagram("Modelica.Blocks.Math.Gain");
    const call = executedCommands.find((c) => c.command === "vscode.openWith");
    expect(call).toBeDefined();
    expect(String(call?.args[0])).toBe(
      "modelica-source:/Modelica.Blocks.Math.Gain.mo",
    );
    expect(call?.args[1]).toBe("modelica.diagram");
  });

  it("does nothing when no class is resolved", async () => {
    await openDiagram(undefined);
    expect(executedCommands.some((c) => c.command === "vscode.openWith")).toBe(
      false,
    );
  });
});

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
      coordinateSystem: {
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
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
        handlers.annotation?.() ?? Promise.resolve({ instance: WITH_ICON })
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

describe("fetchIconLayout: when the annotation path is trusted", () => {
  it("uses the cheap annotation path when it returns a usable Icon", async () => {
    const { client, calls } = makeClient({
      annotation: async () => ({ instance: WITH_ICON }),
    });
    const layout = await fetchIconLayout(client, "Pkg.HasIcon");
    expect(calls).toEqual(["getModelInstanceAnnotation"]);
    expect(layout.kind).toBe("icon");
    expect(layout.iconLayers.length).toBeGreaterThan(0);
  });

  it("does not instantiate a class whose annotation carries no Icon", async () => {
    const { client, calls } = makeClient({
      annotation: async () => ({ instance: NULL_ANNOTATION }),
      full: async () => ({ instance: WITH_ICON }),
    });
    const layout = await fetchIconLayout(client, "Pkg.NullAnno");
    // Instantiating here is what hangs OMC on `String` and costs seconds on
    // deep models, to rediscover there is nothing to paint.
    expect(calls).toEqual(["getModelInstanceAnnotation"]);
    expect(layout.iconLayers).toHaveLength(0);
  });

  // An empty OMC reply throws in `JSON.parse` and a malformed one fails the
  // schema, so throwing is the only way the cheap call fails to answer.
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
      elements: [{ $kind: "extends", baseClass: WITH_ICON }],
    } as unknown as ModelInstance;
    const { client, calls } = makeClient({
      annotation: async () => ({ instance: inherited }),
    });
    const layout = await fetchIconLayout(client, "Pkg.Derived");
    expect(calls).toEqual(["getModelInstanceAnnotation"]);
    // Deleting the instantiating fallback must not cost us inherited icons.
    expect(layout.iconLayers.length).toBeGreaterThan(0);
  });
});

describe("guardAddComponent", () => {
  it("proceeds for a non-partial class", async () => {
    const client: PartialCheckClient = {
      isPartial: async () => ({ b: false }),
    };
    const result = await guardAddComponent(client, "Pkg.ConcreteModel");
    expect(result).toEqual({ kind: "proceed" });
  });

  it("blocks a partial class with a warning-worthy message", async () => {
    const client: PartialCheckClient = { isPartial: async () => ({ b: true }) };
    const result = await guardAddComponent(client, "Pkg.PartialModel");
    expect(result).toEqual({
      kind: "blocked",
      message:
        "Pkg.PartialModel is a partial class and cannot be placed as a component.",
    });
  });

  it("turns a failing isPartial call into a guard-failed result instead of throwing", async () => {
    const client: PartialCheckClient = {
      isPartial: async () => {
        throw new Error("OMC socket timeout");
      },
    };
    const result = await guardAddComponent(client, "Pkg.Unknown");
    expect(result).toEqual({
      kind: "guard-failed",
      message: "isPartial Pkg.Unknown failed: OMC socket timeout",
    });
  });
});
