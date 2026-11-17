import { describe, expect, it } from "vitest";

import {
  isReadOnlyFunction,
  mutationFor,
  mutationsForInput,
} from "./mutation.js";
import { omcFunctionNames, type OmcFnName } from "./registry.js";

describe("mutationFor", () => {
  it("says nothing about a read", () => {
    expect(mutationFor("getComponents(Circuit)")).toBeUndefined();
  });

  it("reads the class from whichever position OMC put it in", () => {
    expect(
      mutationFor("setElementModifierValue(Demo.Circuit, R.R, $Code(=220))"),
    ).toEqual({
      fn: "setElementModifierValue",
      scope: { kind: "class", className: "Demo.Circuit" },
    });
    expect(
      mutationFor(
        "addComponent(r1, Modelica.Electrical.Analog.Basic.Resistor, Demo.Circuit, annotate=Placement(visible=true))",
      ),
    ).toEqual({
      fn: "addComponent",
      scope: { kind: "class", className: "Demo.Circuit" },
    });
    expect(mutationFor("deleteComponent(r1, Demo.Circuit)")).toEqual({
      fn: "deleteComponent",
      scope: { kind: "class", className: "Demo.Circuit" },
    });
  });

  it("keeps a quoted identifier intact inside a dotted name", () => {
    expect(mutationFor("setClassComment(Complex.'-'.negate, \"c\")")).toEqual({
      fn: "setClassComment",
      scope: { kind: "class", className: "Complex.'-'.negate" },
    });
  });

  it("announces an element path as the class enclosing it", () => {
    // The path itself names nothing a cache is keyed by, so announcing it
    // verbatim reaches no listener — indistinguishable from silence.
    expect(
      mutationFor(
        "setElementAnnotation(Demo.Circuit.r1, $Code((Placement(transformation(extent={{0,0},{10,10}})))))",
      ),
    ).toEqual({
      fn: "setElementAnnotation",
      scope: { kind: "class", className: "Demo.Circuit" },
    });
  });

  it("splits an element path outside its quoted identifier", () => {
    expect(
      mutationFor("setElementAnnotation(Demo.'a.b'.r1, $Code((Dialog())))"),
    ).toEqual({
      fn: "setElementAnnotation",
      scope: { kind: "class", className: "Demo.'a.b'" },
    });
  });

  it("goes coarse for an element path with no enclosing class", () => {
    expect(mutationFor("setElementAnnotation(r1, $Code((Dialog())))")).toEqual({
      fn: "setElementAnnotation",
      scope: { kind: "coarse" },
    });
  });

  it("scopes a load to its file rather than the whole session", () => {
    expect(
      mutationFor(
        'loadString("model X end X;", "/w/X.mo", "UTF-8", merge=false)',
      ),
    ).toEqual({
      fn: "loadString",
      scope: { kind: "file", fileName: "/w/X.mo" },
    });
    expect(mutationFor('loadFile("/w/X.mo", "UTF-8", uses=true)')).toEqual({
      fn: "loadFile",
      scope: { kind: "file", fileName: "/w/X.mo" },
    });
  });

  it("is not confused by Modelica source inside a string argument", () => {
    expect(
      mutationFor('loadString("model A end A; // )", "/w/A.mo", "UTF-8")'),
    ).toEqual({
      fn: "loadString",
      scope: { kind: "file", fileName: "/w/A.mo" },
    });
  });

  it("tolerates the trailing semicolon a REPL user types", () => {
    expect(mutationFor("renameComponent(Demo.Circuit, a, b);")).toEqual({
      fn: "renameComponent",
      scope: { kind: "class", className: "Demo.Circuit" },
    });
  });

  it("goes coarse when the affected class is composed, not named", () => {
    expect(mutationFor("renameClass(Demo.Circuit, Loop)")).toEqual({
      fn: "renameClass",
      scope: { kind: "coarse" },
    });
  });

  it("goes coarse when a session setting can change which library a name resolves to", () => {
    expect(mutationFor('setModelicaPath("/ws/lib")')).toEqual({
      fn: "setModelicaPath",
      scope: { kind: "coarse" },
    });
    expect(
      mutationFor('setEnvironmentVar("OPENMODELICALIBRARY", "/ws/lib")'),
    ).toEqual({ fn: "setEnvironmentVar", scope: { kind: "coarse" } });
  });

  it("goes coarse rather than silent when the parse fails", () => {
    expect(mutationFor("x := simulate(Demo.Circuit)")).toEqual({
      fn: undefined,
      scope: { kind: "coarse" },
    });
    expect(mutationFor("renameComponent(")).toEqual({
      fn: undefined,
      scope: { kind: "coarse" },
    });
  });

  it("says nothing about a bare constant reference, which only reads", () => {
    expect(mutationFor("Modelica.Constants.eps")).toBeUndefined();
  });

  it("goes coarse for a bare reference that is not a dotted constant", () => {
    expect(mutationFor("x")).toEqual({
      fn: undefined,
      scope: { kind: "coarse" },
    });
    expect(mutationFor("Demo.'a.b'")).toEqual({
      fn: undefined,
      scope: { kind: "coarse" },
    });
  });

  it("goes coarse rather than silent on a name it does not know", () => {
    expect(mutationFor("renameComponnt(Demo.Circuit, a, b)")).toEqual({
      fn: undefined,
      scope: { kind: "coarse" },
    });
  });

  it("goes coarse when the argument it needs is absent or unreadable", () => {
    expect(mutationFor("renameComponent()")).toEqual({
      fn: "renameComponent",
      scope: { kind: "coarse" },
    });
    expect(
      mutationFor('loadString("model X end X;", filename="/w/X.mo")'),
    ).toEqual({ fn: "loadString", scope: { kind: "coarse" } });
  });

  it("classifies every function the registry can invoke", () => {
    // An unclassified name is indistinguishable from a REPL typo, so it comes
    // back coarse with no function attached — which is what this catches.
    // The two exceptions compose other wrappers instead of naming an OMC
    // function; the calls they make announce themselves individually.
    const unclassified = [...omcFunctionNames].sort().filter((name) => {
      const mutation = mutationFor(`${name}()`);
      return mutation !== undefined && mutation.fn === undefined;
    });

    expect(unclassified).toEqual([
      "setFullDocumentationAnnotation",
      "writeClassGraphics",
    ]);
  });
});

describe("the functions whose command string hides the class they touch", () => {
  it("stay coarse on the string path, where only the text is known", () => {
    expect(
      [
        'copyClass(Demo.A, "B", Demo)',
        "newModel(B, Demo)",
        "deleteClass(Demo.A)",
        "moveClassToTop(Demo.A)",
      ].map(mutationFor),
    ).toEqual([
      { fn: "copyClass", scope: { kind: "coarse" } },
      { fn: "newModel", scope: { kind: "coarse" } },
      { fn: "deleteClass", scope: { kind: "coarse" } },
      { fn: "moveClassToTop", scope: { kind: "coarse" } },
    ]);
  });

  it("are still mutating, so the MCP hint and the write gate see them", () => {
    const named: OmcFnName[] = [
      "copyClass",
      "newModel",
      "deleteClass",
      "moveClassToTop",
    ];
    expect(named.filter(isReadOnlyFunction)).toEqual([]);
  });
});

describe("mutationsForInput", () => {
  it("says nothing for a function its command string already places", () => {
    expect(
      mutationsForInput("addComponent", { classPath: "Demo.A" }),
    ).toBeUndefined();
    expect(mutationsForInput("renameClass", { typeName: "Demo.A" })).toBe(
      undefined,
    );
    expect(
      mutationsForInput("writeClassGraphics", { typeName: "Demo.A" }),
    ).toBeUndefined();
  });

  it("announces the package a class was created or copied into", () => {
    expect(
      mutationsForInput("newModel", { typeName: "B", withinPath: "Demo.Sub" }),
    ).toEqual([
      { fn: "newModel", scope: { kind: "class", className: "Demo.Sub" } },
    ]);
    expect(
      mutationsForInput("copyClass", {
        source: "Demo.A",
        destination: "B",
        within: "Demo",
      }),
    ).toEqual([
      { fn: "copyClass", scope: { kind: "class", className: "Demo" } },
    ]);
  });

  it("goes coarse when the copy lands at the top level", () => {
    // No class name describes the top level, so nothing narrower than a full
    // refresh reaches a listener.
    for (const within of ["", "__OpenModelica_TopLevel"]) {
      expect(
        mutationsForInput("copyClass", {
          source: "Demo.A",
          destination: "B",
          within,
        }),
      ).toEqual([{ fn: "copyClass", scope: { kind: "coarse" } }]);
    }
  });

  it("announces the parent of a reordered class, not the class itself", () => {
    expect(
      mutationsForInput("moveClassToTop", { typeName: "Demo.'a.b'.C" }),
    ).toEqual([
      {
        fn: "moveClassToTop",
        scope: { kind: "class", className: "Demo.'a.b'" },
      },
    ]);
  });

  it("announces both the parent and the deleted class", () => {
    // The parent's listing lost a member; anything keyed by the deleted class
    // itself — an open editor on it, its rendered icon — is gone as well, and
    // announcing the parent reaches neither.
    expect(
      mutationsForInput("deleteClass", { typeName: "Demo.Sub.A" }),
    ).toEqual([
      { fn: "deleteClass", scope: { kind: "class", className: "Demo.Sub" } },
      {
        fn: "deleteClass",
        scope: { kind: "class", className: "Demo.Sub.A" },
      },
    ]);
  });

  it("goes coarse for a top-level class, which has no parent to announce", () => {
    expect(mutationsForInput("deleteClass", { typeName: "Demo" })).toEqual([
      { fn: "deleteClass", scope: { kind: "coarse" } },
    ]);
    expect(mutationsForInput("moveClassToTop", { typeName: "Demo" })).toEqual([
      { fn: "moveClassToTop", scope: { kind: "coarse" } },
    ]);
  });

  it("goes coarse rather than silent when the field is missing", () => {
    expect(mutationsForInput("deleteClass", {})).toEqual([
      { fn: "deleteClass", scope: { kind: "coarse" } },
    ]);
    expect(mutationsForInput("deleteClass", undefined)).toEqual([
      { fn: "deleteClass", scope: { kind: "coarse" } },
    ]);
  });
});

describe("isReadOnlyFunction", () => {
  it("answers for the two composites, which have no OMC function name", () => {
    expect(isReadOnlyFunction("writeClassGraphics")).toBe(false);
    expect(isReadOnlyFunction("setFullDocumentationAnnotation")).toBe(false);
  });

  it("agrees with the announcement a call would make", () => {
    // A function announcing nothing is read-only and vice versa; a hint that
    // disagreed would promise a client a refresh the invalidation never sends.
    const disagreeing = [...omcFunctionNames].sort().filter((name) => {
      if (name === "writeClassGraphics") return false;
      if (name === "setFullDocumentationAnnotation") return false;
      const announces = mutationFor(`${name}()`) !== undefined;
      return announces === isReadOnlyFunction(name);
    });

    expect(disagreeing).toEqual([]);
  });
});
