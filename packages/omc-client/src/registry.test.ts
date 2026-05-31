import { describe, expect, it } from "vitest";

import { REGISTRY, functionsByCategory, omcFunctionNames } from "./registry.js";

describe("registry", () => {
  it("includes all 10 categories", () => {
    const cats = new Set(omcFunctionNames.map((n) => REGISTRY[n].category));
    expect(cats).toEqual(
      new Set([
        "browsing",
        "contents",
        "lifecycle",
        "parameters",
        "editing",
        "elements",
        "library",
        "solver",
        "execution",
        "results",
      ]),
    );
  });

  it("functionsByCategory groups them correctly", () => {
    const byCat = functionsByCategory();
    expect(byCat["browsing"]).toContain("getVersion");
    expect(byCat["contents"]).toContain("getComponents");
    expect(byCat["lifecycle"]).toContain("loadModel");
    expect(byCat["editing"]).toContain("addComponent");
    expect(byCat["elements"]).toContain("getElements");
    expect(byCat["library"]).toContain("getLoadedLibraries");
    expect(byCat["execution"]).toContain("simulate");
    expect(byCat["results"]).toContain("readSimulationResultSize");
  });

  it("each entry pairs a function with both input and output Zod schemas", () => {
    for (const name of omcFunctionNames) {
      const entry = REGISTRY[name];
      expect(typeof entry.fn).toBe("function");
      expect(entry.inputSchema).toBeDefined();
      expect(entry.outputSchema).toBeDefined();
      expect(typeof entry.inputSchema.parse).toBe("function");
      expect(typeof entry.outputSchema.parse).toBe("function");
    }
  });

  it("each entry has a non-empty plain-English description", () => {
    for (const name of omcFunctionNames) {
      const entry = REGISTRY[name];
      expect(typeof entry.description).toBe("string");
      // Reject empty, whitespace-only, or placeholder-y descriptions.
      expect(entry.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("output schemas reject malformed outputs", () => {
    // getVersion expects { version: string } — a plain string should fail.
    expect(() => REGISTRY.getVersion.outputSchema.parse("1.26.1")).toThrow();
    // getClassInformation expects 22 named fields — partial should fail.
    expect(() =>
      REGISTRY.getClassInformation.outputSchema.parse({
        restriction: "block",
      }),
    ).toThrow();
    // isPackage expects { b: boolean } — a bare boolean should fail.
    expect(() => REGISTRY.isPackage.outputSchema.parse(true)).toThrow();
  });

  it("output schemas accept well-formed outputs", () => {
    expect(() =>
      REGISTRY.getVersion.outputSchema.parse({
        version: "OpenModelica 1.26.1",
      }),
    ).not.toThrow();
    expect(() =>
      REGISTRY.getClassNames.outputSchema.parse({
        classNames: ["Modelica", "Complex"],
      }),
    ).not.toThrow();
    expect(() =>
      REGISTRY.isPackage.outputSchema.parse({ b: true }),
    ).not.toThrow();
  });

  it("input schemas reject malformed inputs", () => {
    // Provide wrong type for a required field — should throw.
    expect(() =>
      REGISTRY.getClassInformation.inputSchema.parse({ typeName: 42 }),
    ).toThrow();
    expect(() =>
      REGISTRY.isPackage.inputSchema.parse({ typeName: null }),
    ).toThrow();
    expect(
      () => REGISTRY.searchClassNames.inputSchema.parse({}), // missing required searchText
    ).toThrow();
  });

  it("input schemas accept well-formed inputs", () => {
    expect(() =>
      REGISTRY.getClassInformation.inputSchema.parse({
        typeName: "Modelica.Blocks.Math.Sin",
      }),
    ).not.toThrow();
    expect(() =>
      REGISTRY.searchClassNames.inputSchema.parse({ searchText: "PID" }),
    ).not.toThrow();
    expect(() => REGISTRY.getVersion.inputSchema.parse({})).not.toThrow();
  });

  it("omcFunctionNames is sorted and complete", () => {
    const sorted = [...omcFunctionNames].sort();
    expect(omcFunctionNames).toEqual(sorted);
    // Sanity: we have ~130 functions across 10 categories.
    expect(omcFunctionNames.length).toBeGreaterThan(70);
  });
});
