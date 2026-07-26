/**
 * Integration tests for the `parseString` wrapper.
 *
 * Three guarantees we care about (in priority order):
 *
 *   1. Clean source returns the declared top-level class names.
 *   2. Malformed source does NOT throw from the wrapper — diagnostics go
 *      into OMC's error buffer instead. (live-check.ts depends on this:
 *      it drains the buffer after the call to surface squiggles.)
 *   3. parseString does NOT load the parsed class into OMC's symbol table.
 *      This is the whole point of using parseString over loadString in the
 *      live-check pipeline: live-check fires on every keystroke and must
 *      not pollute the registry.
 */

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";
import { describeIf } from "./fixtures.js";

describeIf("parseString against real OMC", () => {
  let client: OmcClient;

  beforeEach(async () => {
    client = await OmcClient.create({
      omcPath: process.env.OMC_PATH ?? "",
    });
    // Drain any startup chatter so each test's getErrorString reading is
    // attributable to that test only.
    await client.getErrorString();
  });

  afterEach(async () => {
    await client.close();
  });

  it("returns the top-level class name(s) from clean source", async () => {
    const { classNames } = await client.parseString({
      data: "model M end M;",
    });
    expect(classNames).toEqual(["M"]);

    // And the error buffer should be empty after a clean parse.
    const { errorString } = await client.getErrorString();
    expect(errorString).toBe("");
  });

  it("does not throw on malformed source; surfaces diagnostics via getErrorString", async () => {
    // `Real x = 1.0 Real y;` — missing `;` after the first declaration.
    const result = await client.parseString({
      data: "model M Real x = 1.0 Real y; end M;",
    });
    // Wrapper itself didn't throw — the call resolved. OMC may return an
    // empty list, a partial list, or a list with one entry depending on
    // how far the recovery got; the wrapper does not enforce any shape.
    expect(Array.isArray(result.classNames)).toBe(true);

    // The error buffer should reflect the syntax problem.
    const { errorString } = await client.getErrorString();
    expect(errorString.length).toBeGreaterThan(0);
    expect(errorString.toLowerCase()).toMatch(/syntax|error|parse/);
  });

  it("does NOT load the parsed class into OMC's symbol table", async () => {
    // Use a unique-ish name so this assertion can't be confused by
    // anything previously loaded in another test in this file.
    const cls = `MwParseStringProbe_${Math.random().toString(36).slice(2, 10)}`;
    const { classNames } = await client.parseString({
      data: `model ${cls} end ${cls};`,
    });
    expect(classNames).toContain(cls);

    // The symbol table must NOT contain `cls` — that's the non-mutation
    // contract live-check relies on. (If parseString had registered the
    // class, getClassNames would return it from the top level.)
    const { classNames: topLevel } = await client.getClassNames({});
    expect(topLevel).not.toContain(cls);

    // Belt-and-braces: existClass should also say no.
    const { exists } = await client.existClass({ typeName: cls });
    expect(exists).toBe(false);
  });
});
