import { describe, expect, it } from "vitest";

import type { WriteAction, WriteVerdictClient } from "./write-verdict.js";
import { refusalFor, type WriteTargetClient } from "./write-gate.js";
import type { WriteVerdictSource } from "./write-verdict.js";

const REFUSAL =
  "Cannot edit Modelica.Blocks.Math.Sin — it belongs to a read-only system library.";

const LIBRARY_FILE =
  "/home/me/.openmodelica/libraries/Modelica 4.1.0+maint.om/Blocks/Math.mo";

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

/**
 * {@link declaring}'s file-shaped twin: `classNames` is what `parseFile`
 * reports a file declares, rather than what `parseString` reports for text.
 */
function declaringFile(
  classNames: string[],
  loaded: string[] = [],
): WriteVerdictClient & WriteTargetClient {
  return {
    ...client,
    parseFile: async () => ({ classNames }),
    existClass: async ({ typeName }) => ({ exists: loaded.includes(typeName) }),
  };
}

/**
 * {@link declaringFile}, keyed by path: each file reports its own classes, so
 * a batch can hold a benign entry ahead of one that earns a refusal. `parsed`
 * records every path actually sent to `parseFile`, so a test can pin which
 * entries a batch skips without asking OMC anything.
 */
function declaringPerFile(
  byFile: Record<string, string[]>,
  loaded: string[] = [],
): WriteVerdictClient & WriteTargetClient & { parsed: string[] } {
  const parsed: string[] = [];
  return {
    ...client,
    parsed,
    parseFile: async ({ fileName }) => {
      parsed.push(fileName);
      return { classNames: byFile[fileName] ?? [] };
    },
    existClass: async ({ typeName }) => ({ exists: loaded.includes(typeName) }),
  };
}

/**
 * {@link declaringPerFile} with text in front of it: `classNames` is what the
 * source string declares, `byFile` what each path on disk holds.
 */
function declaringIntoFile(
  classNames: string[],
  byFile: Record<string, string[]>,
  loaded: string[] = [],
): WriteVerdictClient & WriteTargetClient & { parsed: string[] } {
  return {
    ...declaringPerFile(byFile, loaded),
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

describe("a call binding the source it carries to a file", () => {
  it("refuses a class bound to a file a read-only library is stored in (#679)", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    // The text declares a bare name, so the `within` clause chooses nothing and
    // the binding is the whole of the write: `save` on `Mine` afterwards
    // rewrites the library file from `Mine` alone.
    const refusal = await refusalFor(
      source,
      declaringIntoFile(
        ["Mine"],
        { [LIBRARY_FILE]: ["Modelica.Blocks.Math.Sin"] },
        ["Modelica.Blocks.Math.Sin"],
      ),
      "loadString",
      { data: "model Mine\n Real x;\nend Mine;\n", filename: LIBRARY_FILE },
    );

    expect(refusal).toBe(REFUSAL);
  });

  it("lets a class the caller owns bind to the file it is stored in", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(
      source,
      declaringIntoFile(
        ["Demo.RLC"],
        { "/workspace/Demo/RLC.mo": ["Demo.RLC"] },
        ["Demo.RLC"],
      ),
      "loadString",
      {
        data: "within Demo;\nmodel RLC end RLC;\n",
        filename: "/workspace/Demo/RLC.mo",
      },
    );

    expect(refusal).toBeUndefined();
    // Text and binding name the same class, and it is asked about once.
    expect(source.asked).toEqual([{ className: "Demo.RLC", action: "edit" }]);
  });

  it("lets a binding to a path nothing is stored in through", async () => {
    const source = verdicts();

    const refusal = await refusalFor(
      source,
      declaringIntoFile(["Mine"], {}),
      "loadString",
      { data: "model Mine end Mine;\n", filename: "/workspace/Mine.mo" },
    );

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([]);
  });

  it("reads nothing for a filename that names no file on disk", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");
    const files = declaringIntoFile(["Mine"], {});

    // `<interactive>` is `loadString`'s own default, and the create flows pass
    // pseudo-paths of the same shape.
    const refusal = await refusalFor(source, files, "loadString", {
      data: "model Mine end Mine;\n",
      filename: "<interactive>",
    });

    expect(refusal).toBeUndefined();
    expect(files.parsed).toEqual([]);
  });
});

describe("a call repointing a class at a file", () => {
  it("refuses a class repointed at a file a read-only library is stored in (#700)", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    // `Mine` is the caller's own class, so judging it alone says nothing: the
    // write is where the call sends it, and a `save` afterwards rewrites the
    // library file from `Mine` alone.
    const refusal = await refusalFor(
      source,
      declaringPerFile({ [LIBRARY_FILE]: ["Modelica.Blocks.Math.Sin"] }, [
        "Modelica.Blocks.Math.Sin",
      ]),
      "setSourceFile",
      { typeName: "Mine", fileName: LIBRARY_FILE },
    );

    expect(refusal).toBe(REFUSAL);
  });

  it("judges the class before reading what the destination holds", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");
    const files = declaringPerFile({});

    const refusal = await refusalFor(source, files, "setSourceFile", {
      typeName: "Modelica.Blocks.Math.Sin",
      fileName: "/workspace/Demo/Sin.mo",
    });

    expect(refusal).toBe(REFUSAL);
    expect(files.parsed).toEqual([]);
  });

  it("lets a class the caller owns move to the file it is already stored in", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(
      source,
      declaringPerFile({ "/workspace/Demo/RLC.mo": ["Demo.RLC"] }, [
        "Demo.RLC",
      ]),
      "setSourceFile",
      { typeName: "Demo.RLC", fileName: "/workspace/Demo/RLC.mo" },
    );

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([{ className: "Demo.RLC", action: "edit" }]);
  });

  it("lets a class move to a path nothing is stored in", async () => {
    const source = verdicts();

    const refusal = await refusalFor(
      source,
      declaringPerFile({}),
      "setSourceFile",
      { typeName: "Demo.RLC", fileName: "/workspace/Demo/Renamed.mo" },
    );

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([{ className: "Demo.RLC", action: "edit" }]);
  });
});

describe("a call carrying a path to a Modelica file", () => {
  it("refuses a file that redefines a class of a read-only library (#676)", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(
      source,
      declaringFile(["Modelica.Blocks.Math.Sin"], ["Modelica.Blocks.Math.Sin"]),
      "loadFile",
      { fileName: "/tmp/pwned.mo" },
    );

    expect(refusal).toBe(REFUSAL);
  });

  it("lets a library file the caller owns through, judged as the edit it is", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(
      source,
      declaringFile(["Demo.RLC"], ["Demo.RLC"]),
      "loadFile",
      { fileName: "/workspace/Demo/RLC.mo" },
    );

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([{ className: "Demo.RLC", action: "edit" }]);
  });

  it("reads the file with the same encoding the real load will use", async () => {
    const source = verdicts();
    const seen: { fileName: string; encoding?: string }[] = [];
    const encodingAware: WriteVerdictClient & WriteTargetClient = {
      ...client,
      parseFile: async (input) => {
        seen.push(input);
        return { classNames: ["Demo.RLC"] };
      },
      existClass: async () => ({ exists: true }),
    };

    await refusalFor(source, encodingAware, "loadFile", {
      fileName: "/workspace/Demo/RLC.mo",
      encoding: "ISO-8859-1",
    });

    expect(seen).toEqual([
      { fileName: "/workspace/Demo/RLC.mo", encoding: "ISO-8859-1" },
    ]);
  });

  it("lets a first load of a system library through: its within scope already exists", async () => {
    const source = verdicts();

    const refusal = await refusalFor(
      source,
      declaringFile(["Modelica.Blocks.Math.Sneaky"], ["Modelica.Blocks.Math"]),
      "loadFile",
      { fileName: "/opt/modelica/Modelica/Blocks/Math/Sneaky.mo" },
    );

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([
      { className: "Modelica.Blocks.Math", action: "createInside" },
    ]);
  });

  it("refuses when OMC cannot be asked what the file declares", async () => {
    const source = verdicts();
    const unreachable = {
      ...client,
      parseFile: async () => {
        throw new Error("omc: no such file");
      },
    };

    const refusal = await refusalFor(source, unreachable, "loadFile", {
      fileName: "/tmp/missing.mo",
    });

    expect(refusal).toContain("omc: no such file");
    expect(source.asked).toEqual([]);
  });

  it("lets an empty or non-string fileName through: nothing the gate can judge", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");
    const files = declaringPerFile({});

    expect(
      await refusalFor(source, files, "loadFile", { fileName: "" }),
    ).toBeUndefined();
    expect(
      await refusalFor(source, files, "loadFile", { fileName: 42 }),
    ).toBeUndefined();
    expect(files.parsed).toEqual([]);
    expect(source.asked).toEqual([]);
  });
});

describe("a call carrying paths to several Modelica files", () => {
  it("judges every file in the array, not only the first", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    // Each path declares a different class, so a gate that stopped reading
    // after the first (benign) file would let this through.
    const refusal = await refusalFor(
      source,
      declaringPerFile(
        {
          "/workspace/Demo/RLC.mo": ["Demo.RLC"],
          "/tmp/pwned.mo": ["Modelica.Blocks.Math.Sin"],
        },
        ["Demo.RLC", "Modelica.Blocks.Math.Sin"],
      ),
      "loadFiles",
      { fileNames: ["/workspace/Demo/RLC.mo", "/tmp/pwned.mo"] },
    );

    expect(refusal).toBe(REFUSAL);
  });

  it("asks once about a scope more than one file in the batch declares into", async () => {
    const source = verdicts();

    const refusal = await refusalFor(
      source,
      declaringPerFile({
        "/workspace/Demo/A.mo": ["Demo.A"],
        "/workspace/Demo/B.mo": ["Demo.B"],
      }),
      "loadFiles",
      { fileNames: ["/workspace/Demo/A.mo", "/workspace/Demo/B.mo"] },
    );

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([
      { className: "Demo", action: "createInside" },
    ]);
  });

  it("reads every file in the batch with the same encoding the real load will use", async () => {
    const source = verdicts();
    const seen: { fileName: string; encoding?: string }[] = [];
    const encodingAware: WriteVerdictClient & WriteTargetClient = {
      ...client,
      parseFile: async (input) => {
        seen.push(input);
        return { classNames: [] };
      },
      existClass: async () => ({ exists: false }),
    };

    await refusalFor(source, encodingAware, "loadFiles", {
      fileNames: ["/workspace/Demo/A.mo", "/workspace/Demo/B.mo"],
      encoding: "ISO-8859-1",
    });

    expect(seen).toEqual([
      { fileName: "/workspace/Demo/A.mo", encoding: "ISO-8859-1" },
      { fileName: "/workspace/Demo/B.mo", encoding: "ISO-8859-1" },
    ]);
  });

  it("lets an array of files the caller owns through", async () => {
    const source = verdicts();

    const refusal = await refusalFor(
      source,
      declaringFile(["Demo.RLC"], ["Demo.RLC"]),
      "loadFiles",
      { fileNames: ["/workspace/Demo/RLC.mo"] },
    );

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([{ className: "Demo.RLC", action: "edit" }]);
  });

  it("lets a non-array fileNames value through: nothing the gate can judge", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");

    const refusal = await refusalFor(source, client, "loadFiles", {
      fileNames: "not-an-array",
    });

    expect(refusal).toBeUndefined();
    expect(source.asked).toEqual([]);
  });

  it("skips entries that are not usable paths, still judging the real ones", async () => {
    const source = verdicts("Modelica.Blocks.Math.Sin");
    const files = declaringPerFile(
      { "/tmp/pwned.mo": ["Modelica.Blocks.Math.Sin"] },
      ["Modelica.Blocks.Math.Sin"],
    );

    const refusal = await refusalFor(source, files, "loadFiles", {
      fileNames: ["", 42, "/tmp/pwned.mo"],
    });

    expect(refusal).toBe(REFUSAL);
    // Pins that "", not just 42, never reaches parseFile — real OMC throws on
    // an empty fileName, which would otherwise turn one junk entry into a
    // refusal of the whole batch instead of skipping past it.
    expect(files.parsed).toEqual(["/tmp/pwned.mo"]);
  });
});
