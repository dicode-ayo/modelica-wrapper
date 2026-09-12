import { describe, expect, it } from "vitest";

import type { WriteAction, WriteVerdictClient } from "./write-verdict.js";
import { refusalFor } from "./write-gate.js";
import type { WriteVerdictSource } from "./write-verdict.js";

const REFUSAL =
  "Cannot edit Modelica.Blocks.Math.Sin — it belongs to a read-only system library.";

/** Records every class a verdict was asked about, refusing the named ones. */
function verdicts(...readOnly: string[]): WriteVerdictSource & {
  asked: { className: string; action: WriteAction }[];
} {
  const asked: { className: string; action: WriteAction }[] = [];
  return {
    asked,
    forClass: async (_client, className, action) => {
      asked.push({ className, action });
      return readOnly.includes(className)
        ? { ok: false, reason: REFUSAL }
        : { ok: true };
    },
  };
}

/** A client no test reaches: the gate decides before OMC is consulted. */
const client = {} as WriteVerdictClient;

describe("refusalFor", () => {
  it("refuses a mutating call on a read-only class, carrying its reason", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(
      source,
      client,
      "setElementModifierValue",
      {
        typeName: "Modelica.Blocks.Math.Sin",
        elementName: "k",
        expr: "2",
      },
    );

    expect(refusal).toBe(REFUSAL);
  });

  it("asks nothing about a read-only function", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(source, client, "getElements", {
      typeName: "Modelica.Blocks.Math.Sin",
    });

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([]);
  });

  it("reads the class from whichever argument the wrapper put it in", async () => {
    const source = verdicts();

    await refusalFor(source, client, "addComponent", {
      componentName: "r1",
      componentClass: "Modelica.Electrical.Analog.Basic.Resistor",
      intoTypeName: "Demo.Circuit",
    });

    expect(source.asked).toEqual([
      { className: "Demo.Circuit", action: "edit" },
    ]);
  });

  it("judges the enclosing class when the argument names an element inside one", async () => {
    const source = verdicts();

    await refusalFor(source, client, "setElementAnnotation", {
      typeName: "Demo.Circuit.r1",
      annotationMod: "annotate(Placement(visible=true))",
    });

    expect(source.asked).toEqual([
      { className: "Demo.Circuit", action: "edit" },
    ]);
  });

  it("judges the destination package when the call creates a class inside it", async () => {
    const source = verdicts();

    await refusalFor(source, client, "newModel", {
      typeName: "Circuit",
      withinPath: "Demo",
    });

    expect(source.asked).toEqual([
      { className: "Demo", action: "createInside" },
    ]);
  });

  it("lets a top-level creation through: an empty name has no verdict", async () => {
    const source = verdicts();

    const refusal = await refusalFor(source, client, "newModel", {
      typeName: "Circuit",
      withinPath: "",
    });

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([]);
  });

  it("gates the shape tools, which all write through writeClassGraphics", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(source, client, "writeClassGraphics", {
      typeName: "Modelica.Blocks.Math.Sin",
      layer: "icon",
      op: { kind: "delete", index: 0 },
    });

    expect(refusal).toBe(REFUSAL);
  });

  // `save` is classified "readOnly" in `@dicode/omc-client`'s `MUTATIONS` (it
  // touches no cache), but it still writes a class's file to disk and reaches
  // OMC through the same `omc_invoke` path as every gated wrapper (issue
  // #654) — it must earn the same refusal a mutating call does.
  it("refuses save on a read-only class, the same as an editing call", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(source, client, "save", {
      typeName: "Modelica.Blocks.Math.Sin",
    });

    expect(refusal).toBe(REFUSAL);
    expect(source.asked).toEqual([
      { className: "Modelica.Blocks.Math.Sin", action: "save" },
    ]);
  });

  it("lets save through for a class that is the user's to write", async () => {
    const source = verdicts();

    const refusal = await refusalFor(source, client, "save", {
      typeName: "Demo.Circuit",
    });

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([
      { className: "Demo.Circuit", action: "save" },
    ]);
  });
});
