/**
 * Tests for the OMC-error → REPL-hint translator.
 */

import { describe, expect, it } from "vitest";

import { diagnoseOmcError } from "./repl-diagnose.js";

const OMC_LOOKUP_FAIL = (fn: string): string =>
  `[<interactive>:1:1-1:0:writable] Error: Class ${fn} not found in scope <global scope> (looking for a function or record).`;

describe("diagnoseOmcError — quoted TypeName mistake", () => {
  it("recognises the pattern and proposes the unquoted call", () => {
    const line =
      'getElementAnnotation("Modelica.Blocks.Examples.PID_Controller")';
    const out = diagnoseOmcError(line, OMC_LOOKUP_FAIL("getElementAnnotation"));
    expect(out).toBeDefined();
    expect(out!).toContain("`getElementAnnotation` exists");
    expect(out!).toContain("TypeName");
    // The suggested rewrite drops the quotes around the dotted name.
    expect(out!).toContain(
      "getElementAnnotation(Modelica.Blocks.Examples.PID_Controller)",
    );
  });

  it("falls back to a generic hint when no quoted dotted-name is found", () => {
    // Same lookup failure, but the call doesn't have a quoted dotted name —
    // the user might have made a different mistake. Still useful to clarify
    // that the function exists.
    const line = "checkModel(notAClass)";
    const out = diagnoseOmcError(line, OMC_LOOKUP_FAIL("checkModel"));
    expect(out).toBeDefined();
    expect(out!).toContain("`checkModel` exists");
    expect(out!).toContain("TypeName");
    // No "Try:" suggestion when there's nothing to unquote.
    expect(out!).not.toContain("Try:");
  });

  it("works for any registered OMC function", () => {
    // Spot-check three more from different categories.
    for (const fn of ["listFile", "getClassInformation", "getElements"]) {
      const out = diagnoseOmcError(`${fn}("Some.Class")`, OMC_LOOKUP_FAIL(fn));
      expect(out, `expected a hint for ${fn}`).toBeDefined();
      expect(out!).toContain(`\`${fn}\` exists`);
    }
  });
});

describe("diagnoseOmcError — should NOT fire", () => {
  it("returns undefined when the failing name is not a registered function", () => {
    // Genuinely missing class — user mistyped a model name.
    const out = diagnoseOmcError(
      "checkModel(Something.NotLoaded)",
      OMC_LOOKUP_FAIL("Something"),
    );
    expect(out).toBeUndefined();
  });

  it("returns undefined for an unrelated OMC error", () => {
    const out = diagnoseOmcError(
      "getVersion()",
      "[<interactive>:1:1] Error: parse error in expression",
    );
    expect(out).toBeUndefined();
  });

  it("returns undefined when the error string is empty", () => {
    expect(diagnoseOmcError("getVersion()", "")).toBeUndefined();
  });

  it("does NOT propose a rewrite when the only quoted string is a non-dotted identifier", () => {
    // "Hello" isn't a Modelica TypeName candidate — single segment, not
    // dotted. We still emit the generic hint but no "Try:" line.
    const line = 'listFile("Hello")';
    const out = diagnoseOmcError(line, OMC_LOOKUP_FAIL("listFile"));
    expect(out).toBeDefined();
    expect(out!).not.toContain("Try:");
  });
});
