/**
 * The reconcile settles nothing after a successful reported edit: the webview
 * already renders it, so the class is only re-read as the base of the *next*
 * one. That rests on the round trip being stable — reconciling the same report
 * a second time must find nothing left to write.
 *
 * If it does not, the difference is invisible. The user sees their own layout,
 * OMC holds something slightly else, and every later gesture silently rewrites
 * the same fields. Mocks cannot answer this; only OMC's own producer can.
 *
 * Gating mirrors the other integration suites: auto-runs when `omc` is on PATH
 * (or `OMC_PATH` / `OMC_INTEGRATION=1` is set), auto-skips otherwise.
 */

import { randomBytes } from "node:crypto";

import { beforeEach, expect, it } from "vitest";

import { OmcClient, type DiagramLayout } from "@dicode/omc-client";

import { describeIf } from "../../test-support/integration-gate.js";
import { applyEdits } from "./apply-edits.js";
import { diffLayouts } from "./diff-layout.js";
import { fetchDiagramLayout } from "./open-diagram.js";

describeIf("reconcile convergence against real OMC", () => {
  let client: OmcClient;
  let cls: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    const pkg = `MwConverge_${randomBytes(4).toString("hex")}`;
    cls = `${pkg}.T`;
    await client.loadModel({ typeName: "Modelica" });
    await client.loadString({
      data: `within ;
package ${pkg}
  model T
    Modelica.Blocks.Sources.Step step1 annotation(Placement(transformation(extent = {{-60, -10}, {-40, 10}})));
    Modelica.Blocks.Math.Gain gain1 annotation(Placement(transformation(extent = {{-10, -10}, {10, 10}})));
  equation
    connect(step1.y, gain1.u) annotation(Line(points = {{-39, 0}, {-12, 0}}));
    annotation(Diagram(coordinateSystem(extent = {{-100, -100}, {100, 100}}), graphics = {
      Rectangle(extent = {{-80, 40}, {80, -40}}, lineColor = {255, 0, 0})}));
  end T;
end ${pkg};
`,
      filename: `${pkg}.mo`,
      merge: false,
    });
  });

  /** What a drag reports: every component shifted, wires re-routed with them. */
  function shifted(base: DiagramLayout): DiagramLayout {
    const next = structuredClone(base) as DiagramLayout;
    const bump = (extent: number[][]): number[][] =>
      extent.map(([x, y]) => [(x ?? 0) + 20, (y ?? 0) + 30]);
    for (const comp of Object.values(next.components)) {
      const p = comp.placement as { extent: number[][] };
      p.extent = bump(p.extent);
    }
    for (const conn of next.connections) {
      const c = conn as { waypoints?: number[][] };
      if (c.waypoints) c.waypoints = bump(c.waypoints);
    }
    return next;
  }

  it("finds nothing left to write when the same report is reconciled twice", async () => {
    const base = await fetchDiagramLayout(client, cls);
    const reported = shifted(base);

    const first = diffLayouts(base, reported);
    expect(first.length).toBeGreaterThan(0);
    const applied = await applyEdits(client, cls, first, undefined, {
      snapshot: true,
    });
    expect(applied.failed).toEqual([]);

    // The base the next gesture reconciles against. Diffing the same report
    // against it is the second reconcile of an unchanged diagram.
    const afterWrite = await fetchDiagramLayout(client, cls);
    expect(diffLayouts(afterWrite, reported)).toEqual([]);
  });

  /**
   * One case per shape kind, each carrying as little as the draw tool sends.
   * A kind covered only by the unit suite is a kind whose defaults were checked
   * against our own table rather than against OMC's answer, which is exactly
   * how `closure` and `fillColor` came to be wrong in both places at once.
   */
  const drawn = [
    {
      what: "a full ellipse, whose closure OMC defaults by its angles",
      shape: {
        kind: "ellipse",
        extent: [
          [10, 10],
          [30, 30],
        ],
        lineColor: [0, 0, 255],
        fillColor: [255, 255, 0],
      },
    },
    {
      what: "a partial ellipse, which takes the other closure default",
      shape: {
        kind: "ellipse",
        extent: [
          [40, 40],
          [60, 60],
        ],
        startAngle: 0,
        endAngle: 180,
      },
    },
    {
      what: "an uncoloured rectangle, whose fillColor OMC materializes",
      shape: {
        kind: "rectangle",
        extent: [
          [10, -30],
          [30, -10],
        ],
      },
    },
    {
      what: "an uncoloured polygon",
      shape: {
        kind: "polygon",
        points: [
          [-30, -10],
          [-20, 10],
          [-10, -10],
        ],
      },
    },
    {
      what: "a line",
      shape: {
        kind: "line",
        points: [
          [-60, 20],
          [-40, 40],
        ],
      },
    },
    {
      what: "a text, whose unset textColor OMC reports as a sentinel",
      shape: {
        kind: "text",
        extent: [
          [50, -40],
          [80, -20],
        ],
        textString: "hi",
      },
    },
  ] as const;

  for (const { what, shape } of drawn) {
    it(`finds nothing left to write when ${what} is reconciled twice`, async () => {
      // The webview sends a shape carrying what the user chose. OMC answers it
      // with every field of the record materialized — `diffLayouts` treats an
      // omitted field as equal to its spec default, so that alone is not a
      // difference the second reconcile rewrites.
      const base = await fetchDiagramLayout(client, cls);
      const withShape = structuredClone(base) as DiagramLayout;
      const layer = withShape.diagramLayers.at(0);
      if (layer === undefined) throw new Error("no own diagram layer");
      layer.shapes = [...layer.shapes, shape] as (typeof layer)["shapes"];

      const first = diffLayouts(base, withShape);
      expect(first.some((e) => e.kind.startsWith("graphics"))).toBe(true);
      const applied = await applyEdits(client, cls, first, undefined, {
        snapshot: true,
      });
      expect(applied.failed).toEqual([]);

      const afterWrite = await fetchDiagramLayout(client, cls);
      const canonical = afterWrite.diagramLayers.at(0)?.shapes.at(-1);
      expect(canonical).toMatchObject(shape);
      // More than it was sent, which is the whole point: the defaults OMC
      // materialized are exactly what the next line proves don't matter.
      expect(Object.keys(canonical ?? {}).length).toBeGreaterThan(
        Object.keys(shape).length,
      );

      // The base the next gesture reconciles against, per `applyChange` in
      // diagram-editor-provider.ts: diffing the still-partial `withShape`
      // report against that canonical read is the second reconcile of an
      // unchanged diagram.
      expect(diffLayouts(afterWrite, withShape)).toEqual([]);
    });
  }
});
