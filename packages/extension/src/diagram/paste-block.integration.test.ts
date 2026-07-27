/**
 * End-to-end gate for the paste block against a real OMC: the text
 * `pasteClipboardItems` generates has to parse and merge, carrying modifiers,
 * placements, connections and shapes in one call. A mocked client only proves
 * we built the string we meant to — not that OMC accepts it.
 *
 * Gating mirrors the omc-client suites: auto-runs when `omc` is on PATH (or
 * `OMC_PATH` / `OMC_INTEGRATION=1` is set); auto-skips otherwise.
 */

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient, type DiagramLayout, type Shape } from "@dicode/omc-client";

import { describeIf } from "../../test-support/integration-gate.js";
import type { ClipboardEntry } from "./clipboard.js";
import { pasteClipboardItems } from "./copy-paste.js";

const GAIN = "Modelica.Blocks.Math.Gain";

/** An empty target layout — paste only reads it for the taken names. */
function emptyLayout(className: string): DiagramLayout {
  return {
    kind: "diagram",
    className,
    source: {
      filename: "x.mo",
      lineStart: 1,
      columnStart: 1,
      lineEnd: 1,
      columnEnd: 1,
    },
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {},
    components: {},
    connectors: {},
    connections: [],
  };
}

function gain(name: string, k: string): ClipboardEntry {
  return {
    kind: "component",
    name,
    className: GAIN,
    extent: [
      [0, 0],
      [20, 20],
    ],
    rotation: 0,
    modifiers: [{ path: "k", expr: k }],
  };
}

describeIf("paste block against real OMC", () => {
  let client: OmcClient;
  let pkg: string;
  let cls: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    const { randomBytes } = await import("node:crypto");
    pkg = `MwPaste_${randomBytes(4).toString("hex")}`;
    cls = `${pkg}.Target`;
    await client.loadModel({ typeName: "Modelica" });
    await client.loadString({
      data: `package ${pkg}
  model Target
    annotation(Diagram(coordinateSystem(extent={{-100,-100},{100,100}}),
      graphics={Rectangle(extent={{-90,-90},{-80,-80}}, lineColor={0,0,255})}));
  end Target;
end ${pkg};
`,
      filename: `<fixture:${pkg}>`,
    });
  });

  afterEach(async () => {
    await client.deleteClass({ typeName: pkg });
    await client.close();
  });

  it("lands components, inline modifiers, connections and shapes in one call", async () => {
    const shape: Shape = {
      kind: "ellipse",
      extent: [
        [0, 0],
        [10, 10],
      ],
      lineColor: [255, 0, 0],
    };
    const items: ClipboardEntry[] = [
      gain("a", "2.5"),
      gain("b", "3"),
      {
        kind: "connection",
        lhs: { component: "a", port: "y" },
        rhs: { component: "b", port: "u" },
        waypoints: [
          [0, 0],
          [10, 10],
        ],
        style: {},
      },
      { kind: "shape", shape },
    ];

    const result = await pasteClipboardItems(
      client,
      cls,
      emptyLayout(cls),
      items,
      "diagram",
      20,
    );
    expect(result.failed).toEqual([]);
    expect(result.added).toEqual(["a1", "b1"]);
    expect(result.connections).toBe(1);
    expect(result.shapes).toBe(1);

    const { contents } = await client.listFile({ typeName: cls });
    // Modifiers rode in on the declaration rather than a second call.
    expect(contents).toContain("a1(k = 2.5)");
    expect(contents).toContain("b1(k = 3)");
    expect(contents).toContain("connect(a1.y, b1.u)");
    expect(contents).toContain("Ellipse");
    // The class's existing graphics survive: OMC merges the annotation.
    expect(contents).toContain("Rectangle");
  });

  it("carries a nested modifier path, which Modelica allows unparenthesized", async () => {
    // `limiter.uMax` addresses a modifier on a sub-component of the pasted
    // class. Modelica permits a dotted name in a modification list, so the
    // declaration needs no rewriting into nested parentheses.
    const result = await pasteClipboardItems(
      client,
      cls,
      emptyLayout(cls),
      [
        {
          kind: "component",
          name: "pid",
          className: "Modelica.Blocks.Continuous.LimPID",
          extent: [
            [0, 0],
            [20, 20],
          ],
          rotation: 0,
          modifiers: [{ path: "limiter.uMax", expr: "5" }],
        },
      ],
      "diagram",
      0,
    );
    expect(result.failed).toEqual([]);

    const { contents } = await client.listFile({ typeName: cls });
    expect(contents).toContain("limiter.uMax = 5");
  });

  it("merges a shapes-only block, keeping the class's existing graphics", async () => {
    // Copying just a rectangle produces a block with no elements ahead of the
    // annotation, which is a different parse than the mixed case.
    const result = await pasteClipboardItems(
      client,
      cls,
      emptyLayout(cls),
      [
        {
          kind: "shape",
          shape: {
            kind: "ellipse",
            extent: [
              [0, 0],
              [10, 10],
            ],
            lineColor: [255, 0, 0],
          },
        },
      ],
      "diagram",
      0,
    );
    expect(result.failed).toEqual([]);
    expect(result.shapes).toBe(1);

    const { contents } = await client.listFile({ typeName: cls });
    expect(contents).toContain("Ellipse");
    expect(contents).toContain("Rectangle");
  });

  it("reports a rejected block and leaves the class untouched", async () => {
    const before = await client.listFile({ typeName: cls });
    const result = await pasteClipboardItems(
      client,
      cls,
      emptyLayout(cls),
      [gain("a", "this is not an expression (")],
      "diagram",
      0,
    );
    expect(result.added).toEqual([]);
    expect(result.failed).toHaveLength(1);
    // OMC's own prose, not a canned string — a rejected block loses the whole
    // paste, so the message is the only thing the user gets.
    expect(result.failed.at(0)).not.toContain("OMC rejected");
    expect(result.failed.at(0)?.length).toBeGreaterThan("paste: ".length);

    const after = await client.listFile({ typeName: cls });
    expect(after.contents).toBe(before.contents);
  });
});
