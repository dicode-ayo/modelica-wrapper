/**
 * End-to-end gate for the paste write path against a real OMC: `addComponent`
 * for each copied instance, `setElementModifierValue` for its authored
 * modifiers, then `addConnection` for the wires between them.
 *
 * Mocks can't answer the questions that actually bite here — whether OMC
 * accepts the `Placement` and `Line` annotations we build, and whether a
 * `connect()` naming freshly-added components resolves — so this drives the
 * real thing and re-reads the class.
 *
 * Gating mirrors the other integration suites: auto-runs when `omc` is on
 * PATH, auto-skips otherwise.
 */

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient } from "@dicode/omc-client";

import { describeIf } from "../../test-support/integration-gate.js";
import { PASTE_OFFSET, type ClipboardEntry } from "./clipboard.js";
import { captureClipboardItems, pasteClipboardItems } from "./copy-paste.js";
import { fetchDiagramLayout } from "./open-diagram.js";

describeIf("paste against real OMC", () => {
  let client: OmcClient;
  let pkg: string;
  let cls: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    const { randomBytes } = await import("node:crypto");
    pkg = `MwPaste_${randomBytes(4).toString("hex")}`;
    cls = `${pkg}.Sample`;
    await client.loadModel({ typeName: "Modelica" });
    await client.loadString({
      data: `package ${pkg}
  model Sample
    Modelica.Blocks.Math.Gain gain1(k=2.5)
      annotation(Placement(transformation(extent={{-40,-10},{-20,10}})));
    Modelica.Blocks.Math.Gain gain2
      annotation(Placement(transformation(extent={{20,-10},{40,10}})));
  equation
    connect(gain1.y, gain2.u)
      annotation(Line(points={{-19,0},{19,0}}, color={0,0,127}));
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

  async function copyBoth(): Promise<ClipboardEntry[]> {
    const layout = await fetchDiagramLayout(client, cls);
    return captureClipboardItems(client, layout, ["c:gain1", "c:gain2"]);
  }

  it("captures both components, their modifier and the wire between them", async () => {
    const items = await copyBoth();
    expect(items.map((i) => i.kind)).toEqual([
      "component",
      "component",
      "connection",
    ]);
    const gain1 = items[0];
    expect(gain1?.kind === "component" && gain1.modifiers).toEqual([
      { path: "k", expr: "2.5" },
    ]);
  });

  it("pastes the pair wired to each other, not to the originals", async () => {
    const before = await fetchDiagramLayout(client, cls);
    const result = await pasteClipboardItems(
      client,
      cls,
      before,
      await copyBoth(),
      "diagram",
      PASTE_OFFSET,
    );
    expect(result.failed).toEqual([]);
    expect(result.added).toEqual(["gain3", "gain4"]);
    expect(result.connections).toBe(1);

    const after = await fetchDiagramLayout(client, cls);
    expect(Object.keys(after.components).sort()).toEqual([
      "gain1",
      "gain2",
      "gain3",
      "gain4",
    ]);
    // The new wire joins the copies; the original is untouched.
    expect(
      after.connections.map((c) => `${c.lhs.component}→${c.rhs.component}`),
    ).toEqual(["gain1→gain2", "gain3→gain4"]);
  });

  it("carries the copied modifier onto the pasted instance", async () => {
    const before = await fetchDiagramLayout(client, cls);
    await pasteClipboardItems(
      client,
      cls,
      before,
      await copyBoth(),
      "diagram",
      PASTE_OFFSET,
    );

    const { value } = await client.getElementModifierValue({
      typeName: cls,
      modifier: "gain3.k",
    });
    expect(value).toBe("2.5");
  });

  it("offsets the pasted placement without moving the original", async () => {
    const before = await fetchDiagramLayout(client, cls);
    await pasteClipboardItems(
      client,
      cls,
      before,
      await copyBoth(),
      "diagram",
      PASTE_OFFSET,
    );

    const after = await fetchDiagramLayout(client, cls);
    expect(after.components.gain1?.placement.extent).toEqual([
      [-40, -10],
      [-20, 10],
    ]);
    expect(after.components.gain3?.placement.extent).toEqual([
      [-40 + PASTE_OFFSET, -10 + PASTE_OFFSET],
      [-20 + PASTE_OFFSET, 10 + PASTE_OFFSET],
    ]);
  });
});
