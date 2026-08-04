/**
 * End-to-end gate for the paste write path against a real OMC: one
 * `loadClassContentString` block carrying every copied declaration, its
 * authored modifiers, and the `connect()` equations between them.
 *
 * Mocks can't answer the questions that actually bite here — whether OMC
 * accepts the `Placement` and `Line` annotations we build, whether a
 * `connect()` naming freshly-added components resolves, and whether an array
 * subscript on a declaration actually round-trips as a vector — so this
 * drives the real thing and re-reads the class.
 *
 * Gating mirrors the other integration suites: auto-runs when `omc` is on
 * PATH, auto-skips otherwise.
 */

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient } from "@dicode/omc-client";

import { describeIf } from "../../test-support/integration-gate.js";
import { PASTE_OFFSET, type ClipboardEntry } from "./clipboard.js";
import {
  captureClipboardItems,
  pastedSelectionKeys,
  pasteClipboardItems,
} from "./copy-paste.js";
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

  it("pastes a standalone connector, wired, and keys it as a connector", async () => {
    // Two things only a live OMC settles: whether a host-class port carries
    // its wire through the copy (its endpoint has no `component`, so identity
    // lives in the port name), and whether OMC files the pasted declaration
    // under `connectors` — which is what decides the `k:` selection key.
    await client.loadString({
      data: `package ${pkg}
  model Ported
    Modelica.Blocks.Interfaces.RealInput u
      annotation(Placement(transformation(extent={{-70,-10},{-50,10}})));
    Modelica.Blocks.Math.Gain gain1
      annotation(Placement(transformation(extent={{-20,-10},{0,10}})));
  equation
    connect(u, gain1.u) annotation(Line(points={{-59,0},{-21,0}}));
  end Ported;
end ${pkg};
`,
      filename: `<fixture:${pkg}-ported>`,
    });
    const ported = `${pkg}.Ported`;

    const before = await fetchDiagramLayout(client, ported);
    const items = await captureClipboardItems(client, before, [
      "k:u",
      "c:gain1",
    ]);
    expect(items.filter((i) => i.kind === "connection")).toHaveLength(1);

    const result = await pasteClipboardItems(
      client,
      ported,
      before,
      items,
      "diagram",
      PASTE_OFFSET,
    );
    expect(result.failed).toEqual([]);
    expect(result.connections).toBe(1);

    const after = await fetchDiagramLayout(client, ported);
    expect(pastedSelectionKeys(after, result, "diagram")).toEqual([
      "k:u1",
      "c:gain2",
    ]);
    expect(
      after.connections.map(
        (c) => `${c.lhs.component ?? c.lhs.port}→${c.rhs.component}`,
      ),
    ).toEqual(["u→gain1", "u1→gain2"]);
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

  it("pastes a copied vector component as a vector, wire and all", async () => {
    await client.loadString({
      data: `package ${pkg}
  model Vectored
    Modelica.Blocks.Math.Gain gain[2](k={1, 2})
      annotation(Placement(transformation(extent={{-40,-10},{-20,10}})));
    Modelica.Blocks.Interfaces.RealOutput y[2]
      annotation(Placement(transformation(extent={{20,-10},{40,10}})));
  equation
    connect(gain.y, y) annotation(Line(points={{-19,0},{19,0}}));
  end Vectored;
end ${pkg};
`,
      filename: `<fixture:${pkg}-vectored>`,
    });
    const vectored = `${pkg}.Vectored`;

    const before = await fetchDiagramLayout(client, vectored);
    expect(before.components.gain?.dims).toEqual(["2"]);

    const items = await captureClipboardItems(client, before, [
      "c:gain",
      "k:y",
    ]);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "component",
          name: "gain",
          dims: ["2"],
        }),
      ]),
    );

    const result = await pasteClipboardItems(
      client,
      vectored,
      before,
      items,
      "diagram",
      PASTE_OFFSET,
    );
    expect(result.failed).toEqual([]);
    expect(result.connections).toBe(1);

    const after = await fetchDiagramLayout(client, vectored);
    expect(after.components.gain1?.dims).toEqual(["2"]);
    const { value } = await client.getElementModifierValue({
      typeName: vectored,
      modifier: "gain1.k",
    });
    expect(value).toBe("{1, 2}");
  });

  it("pastes a wire onto one element of a copied vector, subscript and all", async () => {
    // The failure mode the issue names directly: a connection indexing a
    // single element of the array (`gain[1].y`) rather than the whole thing.
    await client.loadString({
      data: `package ${pkg}
  model Subscripted
    Modelica.Blocks.Math.Gain gain[2]
      annotation(Placement(transformation(extent={{-40,-10},{-20,10}})));
    Modelica.Blocks.Interfaces.RealOutput y
      annotation(Placement(transformation(extent={{20,-10},{40,10}})));
  equation
    connect(gain[1].y, y) annotation(Line(points={{-19,0},{19,0}}));
  end Subscripted;
end ${pkg};
`,
      filename: `<fixture:${pkg}-subscripted>`,
    });
    const subscripted = `${pkg}.Subscripted`;

    const before = await fetchDiagramLayout(client, subscripted);
    const items = await captureClipboardItems(client, before, [
      "c:gain",
      "k:y",
    ]);
    expect(items.filter((i) => i.kind === "connection")).toHaveLength(1);

    const result = await pasteClipboardItems(
      client,
      subscripted,
      before,
      items,
      "diagram",
      PASTE_OFFSET,
    );
    expect(result.failed).toEqual([]);
    expect(result.connections).toBe(1);

    const after = await fetchDiagramLayout(client, subscripted);
    expect(after.components.gain1?.dims).toEqual(["2"]);
    expect(
      after.connections.map(
        (c) =>
          `${c.lhs.component}${c.lhs.componentSubscripts ?? ""}→${c.rhs.component ?? c.rhs.port}`,
      ),
    ).toContain("gain1[1]→y1");
  });
});
