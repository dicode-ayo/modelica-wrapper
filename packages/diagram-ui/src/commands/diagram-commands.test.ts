/**
 * Unit tests for the `diagram.changeClass` command.
 *
 * The command is synchronous and delegates to `CommandTarget.requestClassChange`
 * so the host can present an async input prompt. We assert:
 *   - a single selected component calls `requestClassChange` with the right args;
 *   - selecting zero or two items is silently ignored;
 *   - selecting a non-component entity (e.g. a connector) is silently ignored;
 *   - `readonly` context short-circuits before any call.
 */

import { describe, expect, it, vi } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import { DIAGRAM_COMMANDS } from "./diagram-commands.js";
import type { CommandTarget } from "./command.js";
import type { ContextKeys } from "../interaction/context-keys.js";
import { makeContextKeys } from "../interaction/context-keys.fixture.js";

const changeClassCmd = DIAGRAM_COMMANDS.find(
  (c) => c.id === "diagram.changeClass",
);
if (!changeClassCmd) throw new Error("diagram.changeClass command not found");

function makeLayout(componentName: string, classRef: string): DiagramLayout {
  return {
    components: {
      [componentName]: { classRef } as DiagramLayout["components"][string],
    },
  } as unknown as DiagramLayout;
}

function makeTarget(
  selectedKeys: string[],
  layout: DiagramLayout | null = null,
): {
  target: CommandTarget;
  requestClassChange: ReturnType<typeof vi.fn>;
} {
  const requestClassChange = vi.fn();
  const target: CommandTarget = {
    layout,
    selectedKeys: new Set(selectedKeys),
    contextVertex: null,
    commitLayout: vi.fn(),
    setSelection: vi.fn(),
    requestClassChange,
  };
  return { target, requestClassChange };
}

function makeCtx(overrides: Partial<ContextKeys> = {}): ContextKeys {
  return makeContextKeys({
    selectionCount: 1,
    selectionKind: "component",
    ...overrides,
  });
}

describe("diagram.changeClass command", () => {
  it("calls requestClassChange with componentName and classRef for a single component", () => {
    const layout = makeLayout("gain1", "Modelica.Blocks.Math.Gain");
    const { target, requestClassChange } = makeTarget(["c:gain1"], layout);

    changeClassCmd.run(target);

    expect(requestClassChange).toHaveBeenCalledOnce();
    expect(requestClassChange).toHaveBeenCalledWith(
      "gain1",
      "Modelica.Blocks.Math.Gain",
    );
  });

  it("does nothing when layout is null", () => {
    const { target, requestClassChange } = makeTarget(["c:gain1"], null);

    changeClassCmd.run(target);

    expect(requestClassChange).not.toHaveBeenCalled();
  });

  it("does nothing when selectedKeys is empty", () => {
    const layout = makeLayout("gain1", "Modelica.Blocks.Math.Gain");
    const { target, requestClassChange } = makeTarget([], layout);

    changeClassCmd.run(target);

    expect(requestClassChange).not.toHaveBeenCalled();
  });

  it("does nothing when the selected key is not a component key", () => {
    const layout = makeLayout("gain1", "Modelica.Blocks.Math.Gain");
    // 'k:p' is a standalone connector key, not a component
    const { target, requestClassChange } = makeTarget(["k:p"], layout);

    changeClassCmd.run(target);

    expect(requestClassChange).not.toHaveBeenCalled();
  });

  it("does nothing when the component does not appear in the layout", () => {
    const layout = makeLayout("gain1", "Modelica.Blocks.Math.Gain");
    const { target, requestClassChange } = makeTarget(["c:missing"], layout);

    changeClassCmd.run(target);

    expect(requestClassChange).not.toHaveBeenCalled();
  });

  describe("when guard", () => {
    it("is enabled for a single component in editable mode", () => {
      const ctx = makeCtx();
      expect(changeClassCmd.when?.(ctx)).toBe(true);
    });

    it("is disabled when readonly", () => {
      const ctx = makeCtx({ readonly: true });
      expect(changeClassCmd.when?.(ctx)).toBe(false);
    });

    it("is disabled when nothing is selected", () => {
      const ctx = makeCtx({ selectionCount: 0 });
      expect(changeClassCmd.when?.(ctx)).toBe(false);
    });

    it("is disabled when multiple items are selected", () => {
      const ctx = makeCtx({ selectionCount: 2 });
      expect(changeClassCmd.when?.(ctx)).toBe(false);
    });

    it("is disabled when the selection is not a component", () => {
      const ctx = makeCtx({ selectionKind: "connector" });
      expect(changeClassCmd.when?.(ctx)).toBe(false);
    });
  });
});
