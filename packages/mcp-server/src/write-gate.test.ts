import { describe, expect, it } from "vitest";

import type { WriteAction, WriteVerdictClient } from "./write-verdict.js";
import { refusalFor, type WriteTargetClient } from "./write-gate.js";
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

/** A client no call that names its class reaches: those need no OMC. */
const client = {} as WriteVerdictClient & WriteTargetClient;

/**
 * A client reporting `classNames` as what a source string declares, and every
 * name in `loaded` as already in the symbol table.
 */
function declaring(
  classNames: string[],
  loaded: string[] = [],
): WriteVerdictClient & WriteTargetClient {
  return {
    ...client,
    parseString: async () => ({ classNames }),
    existClass: async ({ typeName }) => ({ exists: loaded.includes(typeName) }),
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
  it("refuses text that redefines a class of a read-only library", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(
      source,
      declaring(["Modelica.Blocks.Math.Sin"], ["Modelica.Blocks.Math.Sin"]),
      "loadString",
      { data: "within Modelica.Blocks.Math;\nmodel Sin\nend Sin;\n" },
    );

    expect(refusal).toBe(REFUSAL);
  });

  it("judges the within scope for a class the text is introducing", async () => {
    const source = verdicts("Modelica.Blocks.Math");

    const refusal = await refusalFor(
      source,
      declaring(["Modelica.Blocks.Math.Sneaky"]),
      "loadString",
      { data: "within Modelica.Blocks.Math;\nmodel Sneaky\nend Sneaky;\n" },
    );

    // Nothing about a class OMC has never seen can be judged, so what has to
    // allow it is the package the `within` clause puts it in.
    expect(refusal).toBe(REFUSAL);
    expect(source.asked).toEqual([
      { className: "Modelica.Blocks.Math", action: "createInside" },
    ]);
  });

  it("judges every class the text declares, not only the first", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");
    const loaded = ["Modelica.Blocks.Math.Cos", "Modelica.Blocks.Math.Sin"];

    const refusal = await refusalFor(
      source,
      declaring(loaded, loaded),
      "loadString",
      {
        data: "within Modelica.Blocks.Math;\nmodel Cos end Cos;\nmodel Sin end Sin;\n",
      },
    );

    expect(refusal).toBe(REFUSAL);
  });

  it("asks once about a scope several declared classes share", async () => {
    const source = verdicts();

    const refusal = await refusalFor(
      source,
      declaring(["Demo.A", "Demo.B", "Demo.C"]),
      "loadString",
      {
        data: "within Demo;\nmodel A end A;\nmodel B end B;\nmodel C end C;\n",
      },
    );

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([
      { className: "Demo", action: "createInside" },
    ]);
  });

  it("lets a class of the caller's own through, judged as the edit it is", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(
      source,
      declaring(["Demo.RLC"], ["Demo.RLC"]),
      "loadString",
      { data: "within Demo;\nmodel RLC end RLC;\n" },
    );

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([{ className: "Demo.RLC", action: "edit" }]);
  });

  it("lets a top-level class through: a bare name has no scope to judge", async () => {
    const source = verdicts();

    const refusal = await refusalFor(
      source,
      declaring(["Mine"]),
      "loadString",
      {
        data: "model Mine end Mine;\n",
      },
    );

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([]);
  });

  it("refuses when OMC cannot be asked what the text declares", async () => {
    const source = verdicts();
    const unreachable = {
      ...client,
      parseString: async () => {
        throw new Error("omc: call timed out");
      },
    };

    const refusal = await refusalFor(source, unreachable, "loadString", {
      data: "within Demo;\nmodel RLC end RLC;\n",
    });

    // Nothing judged the write, so nothing may permit it either.
    expect(refusal).toContain("omc: call timed out");
    expect(source.asked).toEqual([]);
  });

  it("lets text that declares nothing through: the load reports the parse failure", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(source, declaring([]), "loadString", {
      data: "this is not Modelica",
    });

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([]);
  });
});
