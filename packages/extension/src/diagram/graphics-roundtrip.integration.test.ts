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

import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  OmcClient,
  type EllipseShape,
  type RectangleShape,
  type Value,
} from "@dicode/omc-client";

function shouldRun(): boolean {
  const flag = process.env.OMC_INTEGRATION;
  if (flag === "0") return false;
  if (flag === "1") return true;
  if (process.env.OMC_PATH && process.env.OMC_PATH.length > 0) return true;
  try {
    execSync(process.platform === "win32" ? "where omc" : "command -v omc", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const describeIf = shouldRun() ? describe : describe.skip;

const GRAPHICS_INDEX = 8;

/** The graphic records of an Icon/Diagram annotation Value tree. */
function graphics(annotation: Value): Value[] {
  const items = annotation.kind === "list" ? annotation.items : [];
  const list = items.at(GRAPHICS_INDEX);
  return list && list.kind === "list" ? list.items : [];
}

/** Names of the graphic records, e.g. `["Rectangle", "Text"]`. */
function graphicsNames(annotation: Value): string[] {
  return graphics(annotation).map((g) => (g.kind === "call" ? g.name : g.kind));
}

/** The leading coordinateSystem extent, or nulls when unset. */
function extentNumbers(annotation: Value): (number | null)[] {
  const items = annotation.kind === "list" ? annotation.items : [];
  return items
    .slice(0, 4)
    .map((v) => (v.kind === "int" || v.kind === "float" ? v.value : null));
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
    expect(extentNumbers(after.annotation)).toEqual([-100, -100, 100, 100]);

    // The added shape's distinctive fields round-trip through OMC's
    // named-arg → positional-record normalization.
    const serialized = JSON.stringify(graphics(after.annotation));
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
    expect(extentNumbers(after.annotation)).toEqual([-100, -100, 100, 100]);
    // The pre-existing Text body survived the re-serialize.
    const serialized = JSON.stringify(graphics(after.annotation));
    expect(serialized).toContain('"hi"');
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
    expect(extentNumbers(after.annotation)).toEqual([-100, -100, 100, 100]);
  });
});
