/**
 * Unit tests for `diagram.goToDefinition` / `diagram.goToDeclaration`.
 *
 * The commands are synchronous and delegate to
 * `CommandTarget.requestGoToSource` (editors live host-side). We pin:
 *   - the per-entity resolution table (component / standalone connector →
 *     type source, connection → connect() equation, empty selection → host
 *     class, everything else → null);
 *   - that an entity without a source resolves to nothing, so the `when`
 *     gate keeps the command off the menu instead of a silent no-op;
 *   - the F12 default binding.
 */

import { describe, expect, it, vi } from "vitest";
import type { DiagramLayout, SourceLocation } from "@dicode/omc-client";

import {
  DEFAULT_KEYMAP,
  DIAGRAM_COMMANDS,
  resolveDeclarationSource,
  resolveDefinitionSource,
} from "./diagram-commands.js";
import type { Command, CommandTarget } from "./command.js";
import { makeContextKeys } from "../interaction/context-keys.fixture.js";

function command(id: string): Command {
  const c = DIAGRAM_COMMANDS.find((x) => x.id === id);
  if (!c) throw new Error(`no command ${id}`);
  return c;
}

function loc(filename: string, lineStart = 3): SourceLocation {
  return {
    filename,
    lineStart,
    columnStart: 1,
    lineEnd: lineStart + 4,
    columnEnd: 9,
  };
}

const HOST_SOURCE = loc("/lib/Pkg/M.mo", 1);
const GAIN_TYPE_SOURCE = loc("/msl/Gain.mo");
const GAIN_DECL_SOURCE = loc("/lib/Pkg/M.mo", 7);
const PIN_TYPE_SOURCE = loc("/msl/Pin.mo");
const CONNECT_SOURCE = loc("/lib/Pkg/M.mo", 12);

function makeLayout(): DiagramLayout {
  return {
    kind: "diagram",
    className: "Pkg.M",
    source: HOST_SOURCE,
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {},
    components: {
      gain1: {
        name: "gain1",
        classRef: "Modelica.Blocks.Math.Gain",
        placement: {
          extent: [
            [-10, -10],
            [10, 10],
          ],
        },
        source: GAIN_TYPE_SOURCE,
        declarationSource: GAIN_DECL_SOURCE,
      },
      bare: {
        name: "bare",
        classRef: "Pkg.NoSource",
        placement: {
          extent: [
            [-10, -10],
            [10, 10],
          ],
        },
      },
    },
    connectors: {
      p: {
        name: "p",
        classRef: "Modelica.Electrical.Analog.Interfaces.Pin",
        placement: {
          extent: [
            [-10, -10],
            [10, 10],
          ],
        },
        source: PIN_TYPE_SOURCE,
      },
    },
    connections: [
      {
        lhs: { component: "gain1", port: "y" },
        rhs: { component: undefined, port: "p" },
        waypoints: [],
        source: CONNECT_SOURCE,
      },
      {
        lhs: { component: undefined, port: "p" },
        rhs: { component: "gain1", port: "u" },
        waypoints: [],
      },
    ],
  };
}

describe("resolveDefinitionSource", () => {
  const layout = makeLayout();

  it("resolves a component to its TYPE's class source", () => {
    expect(resolveDefinitionSource(layout, new Set(["c:gain1"]))).toEqual({
      source: GAIN_TYPE_SOURCE,
      fallbackClassName: "Modelica.Blocks.Math.Gain",
    });
  });

  it("resolves a standalone connector to its type's class source", () => {
    expect(resolveDefinitionSource(layout, new Set(["k:p"]))).toEqual({
      source: PIN_TYPE_SOURCE,
      fallbackClassName: "Modelica.Electrical.Analog.Interfaces.Pin",
    });
  });

  it("resolves a connection to its connect() equation in the host class", () => {
    expect(resolveDefinitionSource(layout, new Set(["edge:0"]))).toEqual({
      source: CONNECT_SOURCE,
      fallbackClassName: "Pkg.M",
    });
  });

  it("resolves an empty selection to the host class", () => {
    expect(resolveDefinitionSource(layout, new Set())).toEqual({
      source: HOST_SOURCE,
      fallbackClassName: "Pkg.M",
    });
  });

  it("resolves nothing for a component that carries no source", () => {
    expect(resolveDefinitionSource(layout, new Set(["c:bare"]))).toBeNull();
  });

  it("resolves nothing for a connection that carries no source", () => {
    expect(resolveDefinitionSource(layout, new Set(["edge:1"]))).toBeNull();
  });

  it("resolves nothing for a sub-component port, a shape, a multi-selection, or a missing layout", () => {
    expect(resolveDefinitionSource(layout, new Set(["k:gain1.u"]))).toBeNull();
    expect(
      resolveDefinitionSource(layout, new Set(["shape:line:0"])),
    ).toBeNull();
    expect(
      resolveDefinitionSource(layout, new Set(["c:gain1", "k:p"])),
    ).toBeNull();
    expect(resolveDefinitionSource(null, new Set())).toBeNull();
  });
});

describe("resolveDeclarationSource", () => {
  const layout = makeLayout();

  it("resolves a component to its own declaration in the host class", () => {
    expect(resolveDeclarationSource(layout, new Set(["c:gain1"]))).toEqual({
      source: GAIN_DECL_SOURCE,
      fallbackClassName: "Pkg.M",
    });
  });

  it("resolves nothing without a declarationSource, an entity of another kind, or an empty selection", () => {
    expect(resolveDeclarationSource(layout, new Set(["c:bare"]))).toBeNull();
    expect(resolveDeclarationSource(layout, new Set(["k:p"]))).toBeNull();
    expect(resolveDeclarationSource(layout, new Set(["edge:0"]))).toBeNull();
    expect(resolveDeclarationSource(layout, new Set())).toBeNull();
  });
});

function makeTarget(
  selectedKeys: string[],
  layout: DiagramLayout | null,
): { target: CommandTarget; requestGoToSource: ReturnType<typeof vi.fn> } {
  const requestGoToSource = vi.fn();
  return {
    target: {
      layout,
      selectedKeys: new Set(selectedKeys),
      contextVertex: null,
      commitLayout: vi.fn(),
      setSelection: vi.fn(),
      requestGoToSource,
    },
    requestGoToSource,
  };
}

describe("diagram.goToDefinition command", () => {
  const cmd = command("diagram.goToDefinition");

  it("delegates the resolved type source to requestGoToSource", () => {
    const { target, requestGoToSource } = makeTarget(["c:gain1"], makeLayout());
    cmd.run(target);
    expect(requestGoToSource).toHaveBeenCalledOnce();
    expect(requestGoToSource).toHaveBeenCalledWith({
      source: GAIN_TYPE_SOURCE,
      fallbackClassName: "Modelica.Blocks.Math.Gain",
    });
  });

  it("does nothing when nothing resolves", () => {
    const { target, requestGoToSource } = makeTarget(["c:bare"], makeLayout());
    cmd.run(target);
    expect(requestGoToSource).not.toHaveBeenCalled();
  });

  it("is gated on hasDefinitionSource and ignores readonly", () => {
    expect(cmd.when?.(makeContextKeys({ hasDefinitionSource: true }))).toBe(
      true,
    );
    expect(
      cmd.when?.(
        makeContextKeys({ hasDefinitionSource: true, readonly: true }),
      ),
    ).toBe(true);
    expect(cmd.when?.(makeContextKeys())).toBe(false);
  });

  it("is bound to F12 by default", () => {
    expect(DEFAULT_KEYMAP.get("F12")).toBe("diagram.goToDefinition");
  });
});

describe("diagram.goToDeclaration command", () => {
  const cmd = command("diagram.goToDeclaration");

  it("delegates the instance's declaration source to requestGoToSource", () => {
    const { target, requestGoToSource } = makeTarget(["c:gain1"], makeLayout());
    cmd.run(target);
    expect(requestGoToSource).toHaveBeenCalledOnce();
    expect(requestGoToSource).toHaveBeenCalledWith({
      source: GAIN_DECL_SOURCE,
      fallbackClassName: "Pkg.M",
    });
  });

  it("is gated on hasDeclarationSource", () => {
    expect(cmd.when?.(makeContextKeys({ hasDeclarationSource: true }))).toBe(
      true,
    );
    expect(cmd.when?.(makeContextKeys())).toBe(false);
  });
});
