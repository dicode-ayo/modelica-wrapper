/**
 * Paste offsets a copied shape by shifting its `origin`, which only moves the
 * shape if OMC keeps that field through the write and hands it back on the
 * re-read. `origin` is absent on most authored shapes (it defaults to
 * `{0,0}`), so paste is the first writer to set one — a serializer that
 * dropped it, or an OMC normalization that folded it away, would land every
 * pasted shape exactly on top of its original with no visible offset and no
 * error.
 *
 * Gating mirrors the other integration suites: auto-runs when `omc` is on
 * PATH, auto-skips otherwise.
 */

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient, type RectangleShape } from "@dicode/omc-client";

import { describeIf } from "../../test-support/integration-gate.js";
import { offsetShape, PASTE_OFFSET } from "./clipboard.js";
import { fetchIconLayout } from "./open-diagram.js";

describeIf("paste offset against real OMC", () => {
  let client: OmcClient;
  let pkg: string;
  let cls: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    const { randomBytes } = await import("node:crypto");
    pkg = `MwPasteOff_${randomBytes(4).toString("hex")}`;
    cls = `${pkg}.Sample`;
    await client.loadString({
      data: `package ${pkg}
  model Sample
    annotation(Icon(
      coordinateSystem(extent={{-100,-100},{100,100}}),
      graphics={
        Rectangle(extent={{-40,-40},{40,40}}, lineColor={0,0,255})
      }));
  end Sample;
end ${pkg};
`,
      filename: `<fixture:${pkg}>`,
    });
  });

  afterEach(async () => {
    await client.deleteClass({ typeName: pkg });
    await client.close();
  });

  it("moves a pasted shape by writing the origin the copy never had", async () => {
    const original: RectangleShape = {
      kind: "rectangle",
      extent: [
        [-40, -40],
        [40, 40],
      ],
      lineColor: [0, 0, 255],
    };
    expect(original.origin).toBeUndefined();

    const res = await client.writeClassGraphics({
      typeName: cls,
      layer: "icon",
      op: { kind: "add", shape: offsetShape(original, PASTE_OFFSET) },
    });
    expect(res.success).toBe(true);

    const layout = await fetchIconLayout(client, cls);
    const shapes = layout.iconLayers.at(-1)?.shapes ?? [];

    // The original is untouched; the pasted copy carries the offset, and its
    // extent is unchanged — origin translates, it doesn't resize.
    expect(shapes.map((s) => s.origin)).toEqual([
      undefined,
      [PASTE_OFFSET, PASTE_OFFSET],
    ]);
    expect(shapes.at(-1)).toMatchObject({
      kind: "rectangle",
      extent: [
        [-40, -40],
        [40, 40],
      ],
    });
  });
});
