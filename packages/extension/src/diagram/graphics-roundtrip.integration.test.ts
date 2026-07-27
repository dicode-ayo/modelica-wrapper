/**
 * Round-trip gate for the graphics write path (#186). Drives
 * `client.writeClassGraphics` against a real OMC install and re-reads the Icon
 * to prove the acceptance contract:
 *
 *   1. An added shape lands AND the pre-existing shapes survive.
 *   2. The coordinateSystem extent survives (addClassAnnotation replaces the
 *      whole Icon, so a dropped extent would null out here).
 *   3. The added shape's distinctive fields make the round trip through OMC's
 *      named-arg → positional-record normalization.
 *   4. A pre-existing Text survives — its positional record carries an empty
 *      `textStyle={}` that OMC won't re-parse verbatim, so the write must
 *      re-serialize existing shapes rather than echo them.
 *
 * Gating mirrors the omc-client suites: auto-runs when `omc` is on PATH (or
 * `OMC_PATH` / `OMC_INTEGRATION=1` is set); auto-skips otherwise.
 */

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  OmcClient,
  annotationCoordinateSystem,
  annotationGraphics,
  type EllipseShape,
  type RectangleShape,
  type Value,
} from "@dicode/omc-client";
import { describeIf } from "../../test-support/integration-gate.js";

/** Names of the graphic records, e.g. `["Rectangle", "Text"]`. */
function graphicsNames(annotation: Value): string[] {
  return annotationGraphics(annotation).map((g) =>
    g.kind === "call" ? g.name : g.kind,
  );
}

describeIf("writeClassGraphics round-trip against real OMC", () => {
  let client: OmcClient;
  let pkg: string;
  let cls: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    const { randomBytes } = await import("node:crypto");
    pkg = `MwGfxRt_${randomBytes(4).toString("hex")}`;
    cls = `${pkg}.Sample`;
    await client.loadModel({ typeName: "Modelica" });
  });

  afterEach(async () => {
    await client.deleteClass({ typeName: pkg });
    await client.close();
  });

  it("adds a shape while keeping the existing shape and the coordinate system", async () => {
    await client.loadString({
      data: `package ${pkg}
  model Sample
    annotation(Icon(
      coordinateSystem(extent={{-100,-100},{100,100}}),
      graphics={
        Rectangle(extent={{-40,-40},{40,40}}, lineColor={0,0,255}, fillColor={255,0,0}, fillPattern=FillPattern.Solid)
      }));
  end Sample;
end ${pkg};
`,
      filename: `<fixture:${pkg}>`,
    });

    const added: RectangleShape = {
      kind: "rectangle",
      extent: [
        [50, 50],
        [70, 70],
      ],
      lineColor: [0, 0, 0],
      fillColor: [7, 8, 9],
      fillPattern: "Solid",
      rotation: 42,
    };

    const res = await client.writeClassGraphics({
      typeName: cls,
      layer: "icon",
      op: { kind: "add", shape: added },
    });
    expect(res.success).toBe(true);

    const after = await client.getIconAnnotation({ typeName: cls });
    expect(graphicsNames(after.annotation)).toEqual(["Rectangle", "Rectangle"]);
    // coordinateSystem extent must survive the whole-Icon replace.
    expect(annotationCoordinateSystem(after.annotation).extent).toEqual([
      -100, -100, 100, 100,
    ]);

    // The added shape's distinctive fields round-trip through OMC's
    // named-arg → positional-record normalization.
    const serialized = JSON.stringify(annotationGraphics(after.annotation));
    expect(serialized).toContain('"value":42');
    expect(serialized).toContain('"value":7');
    expect(serialized).toContain('"value":8');
    expect(serialized).toContain('"value":9');
  });

  it("inserts a shape that coexists with Rectangle + Text + Line (Text survives)", async () => {
    await client.loadString({
      data: `package ${pkg}
  model Sample
    annotation(Icon(
      coordinateSystem(extent={{-100,-100},{100,100}}),
      graphics={
        Rectangle(extent={{-40,-40},{40,40}}, lineColor={0,0,255}),
        Text(extent={{-30,-10},{30,10}}, textString="hi", lineColor={0,128,0}),
        Line(points={{0,0},{10,10}}, color={1,2,3}, pattern=LinePattern.Dot)
      }));
  end Sample;
end ${pkg};
`,
      filename: `<fixture:${pkg}>`,
    });

    const before = await client.getIconAnnotation({ typeName: cls });
    expect(graphicsNames(before.annotation)).toEqual([
      "Rectangle",
      "Text",
      "Line",
    ]);

    const added: EllipseShape = {
      kind: "ellipse",
      extent: [
        [1, 1],
        [2, 2],
      ],
      lineColor: [10, 20, 30],
      startAngle: 10,
      endAngle: 90,
      closure: "Radial",
    };

    const res = await client.writeClassGraphics({
      typeName: cls,
      layer: "icon",
      op: { kind: "add", shape: added },
    });
    expect(res.success).toBe(true);

    const after = await client.getIconAnnotation({ typeName: cls });
    expect(graphicsNames(after.annotation)).toEqual([
      "Rectangle",
      "Text",
      "Line",
      "Ellipse",
    ]);
    expect(annotationCoordinateSystem(after.annotation).extent).toEqual([
      -100, -100, 100, 100,
    ]);
    // The pre-existing Text body survived the re-serialize.
    const serialized = JSON.stringify(annotationGraphics(after.annotation));
    expect(serialized).toContain('"hi"');
  });

  it("preserves a non-default coordinateSystem (grid/initialScale/preserveAspectRatio)", async () => {
    await client.loadString({
      data: `package ${pkg}
  model Sample
    annotation(Icon(
      coordinateSystem(extent={{-50,-50},{50,50}}, preserveAspectRatio=false, initialScale=0.5, grid={5,7}),
      graphics={
        Rectangle(extent={{-1,-1},{1,1}}, lineColor={0,0,255})
      }));
  end Sample;
end ${pkg};
`,
      filename: `<fixture:${pkg}>`,
    });

    const res = await client.writeClassGraphics({
      typeName: cls,
      layer: "icon",
      op: {
        kind: "add",
        shape: {
          kind: "rectangle",
          extent: [
            [2, 2],
            [3, 3],
          ],
        },
      },
    });
    expect(res.success).toBe(true);

    const after = await client.getIconAnnotation({ typeName: cls });
    expect(annotationCoordinateSystem(after.annotation)).toEqual({
      extent: [-50, -50, 50, 50],
      preserveAspectRatio: false,
      initialScale: 0.5,
      grid: [5, 7],
    });
  });

  it("deletes a shape by index", async () => {
    await client.loadString({
      data: `package ${pkg}
  model Sample
    annotation(Icon(
      coordinateSystem(extent={{-100,-100},{100,100}}),
      graphics={
        Rectangle(extent={{-40,-40},{40,40}}, lineColor={0,0,255}),
        Ellipse(extent={{1,1},{2,2}}, lineColor={10,20,30})
      }));
  end Sample;
end ${pkg};
`,
      filename: `<fixture:${pkg}>`,
    });

    const res = await client.writeClassGraphics({
      typeName: cls,
      layer: "icon",
      op: { kind: "delete", index: 0 },
    });
    expect(res.success).toBe(true);

    const after = await client.getIconAnnotation({ typeName: cls });
    expect(graphicsNames(after.annotation)).toEqual(["Ellipse"]);
    expect(annotationCoordinateSystem(after.annotation).extent).toEqual([
      -100, -100, 100, 100,
    ]);
  });
});
