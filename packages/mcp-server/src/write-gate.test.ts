import { describe, expect, it } from "vitest";

import type { WriteAction, WriteVerdictClient } from "./write-verdict.js";
import { refusalFor, type SourceParseClient } from "./write-gate.js";
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
const client = {} as WriteVerdictClient & SourceParseClient;

/** A client whose `parseString` reports `classNames`, as OMC's does. */
function declaring(
  ...classNames: string[]
): WriteVerdictClient & SourceParseClient {
  return {
    ...client,
    parseString: async () => ({ classNames }),
  };
}

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
});

describe("a call carrying Modelica source", () => {
  it("refuses text whose within clause lands on a read-only class", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(
      source,
      declaring("Modelica.Blocks.Math.Sin"),
      "loadString",
      {
        data: "within Modelica.Blocks.Math;\nmodel Sin\nend Sin;\n",
      },
    );

    expect(refusal).toBe(REFUSAL);
  });

  it("judges the within scope too, for a class that does not exist yet", async () => {
    const source = verdicts();

    await refusalFor(source, declaring("Demo.Sub.Fresh"), "loadString", {
      data: "within Demo.Sub;\nmodel Fresh\nend Fresh;\n",
    });

    // The class lookup fails open for a name OMC cannot resolve, so the scope
    // it would be created in is the only thing left to judge.
    expect(source.asked).toEqual([
      { className: "Demo.Sub.Fresh", action: "edit" },
      { className: "Demo.Sub", action: "createInside" },
    ]);
  });

  it("judges every class the text declares, not only the first", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(
      source,
      declaring("Modelica.Blocks.Math.Cos", "Modelica.Blocks.Math.Sin"),
      "loadString",
      {
        data: "within Modelica.Blocks.Math;\nmodel Cos end Cos;\nmodel Sin end Sin;\n",
      },
    );

    expect(refusal).toBe(REFUSAL);
  });

  it("lets text OMC cannot parse through: the load that follows reports it", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(source, declaring(), "loadString", {
      data: "this is not Modelica",
    });

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([]);
  });
});
