import { describe, expect, it } from "vitest";

import { mutationFor } from "./mutation.js";
import { omcFunctionNames } from "./registry.js";

describe("mutationFor", () => {
  it("says nothing about a read", () => {
    expect(mutationFor("getComponents(Circuit)")).toBeUndefined();
  });

  it("scopes a mutation to the class its arguments name", () => {
    expect(
      mutationFor("setElementModifierValue(Circuit, R.R, $Code(=220))"),
    ).toEqual({
      fn: "setElementModifierValue",
      scope: { kind: "class", className: "Circuit" },
    });
  });

  it("reads the class from whichever position OMC put it in", () => {
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
    expect(mutationFor("deleteClass(Complex.'-'.negate)")).toEqual({
      fn: "deleteClass",
      scope: { kind: "class", className: "Complex.'-'.negate" },
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
    expect(mutationFor("deleteClass(Demo.Circuit);")).toEqual({
      fn: "deleteClass",
      scope: { kind: "class", className: "Demo.Circuit" },
    });
  });

  it("goes coarse when the affected class is composed, not named", () => {
    expect(mutationFor("renameClass(Demo.Circuit, Loop)")).toEqual({
      fn: "renameClass",
      scope: { kind: "coarse" },
    });
  });

  it("goes coarse rather than silent when the parse fails", () => {
    expect(mutationFor("x := simulate(Demo.Circuit)")).toEqual({
      fn: undefined,
      scope: { kind: "coarse" },
    });
    expect(mutationFor("deleteClass(")).toEqual({
      fn: undefined,
      scope: { kind: "coarse" },
    });
  });

  it("goes coarse rather than silent on a name it does not know", () => {
    expect(mutationFor("deleteClas(Demo.Circuit)")).toEqual({
      fn: undefined,
      scope: { kind: "coarse" },
    });
  });

  it("goes coarse when the argument it needs is absent or unreadable", () => {
    expect(mutationFor("deleteClass()")).toEqual({
      fn: "deleteClass",
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
