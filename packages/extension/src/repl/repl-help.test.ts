/**
 * Tests for the REPL-side `:help` dispatcher.
 *
 * The structural rendering (`renderFunctionHelp`, `renderCategoryHelp`,
 * `renderOverview`, schema introspection) is owned by
 * `@modelica-wrapper/omc-client` and tested in its own suite. This file
 * only covers what the REPL layer adds: meta-commands, the overview
 * composition, and topic routing.
 */

import { describe, expect, it } from "vitest";

import { META_COMMANDS, formatHelp } from "./repl-help.js";

describe("formatHelp — overview (no arg)", () => {
  it("lists every meta-command with its summary", () => {
    const { output, unknown } = formatHelp(undefined);
    expect(unknown).toBe(false);
    for (const m of META_COMMANDS) {
      expect(output).toContain(m.name);
      expect(output).toContain(m.summary);
    }
  });

  it("composes the meta section in front of the OMC API overview", () => {
    const { output } = formatHelp("");
    const metaIdx = output.indexOf("Modelica REPL meta-commands:");
    const apiIdx = output.indexOf("OMC API");
    expect(metaIdx).toBeGreaterThanOrEqual(0);
    expect(apiIdx).toBeGreaterThan(metaIdx);
  });
});

describe("formatHelp — topic routing", () => {
  it("routes a category arg to the omc-client category renderer", () => {
    const { output, unknown } = formatHelp("execution");
    expect(unknown).toBe(false);
    // The omc-client renderer's signature line.
    expect(output).toMatch(/^execution — \d+ functions:/);
  });

  it("routes a function-name arg to the omc-client function renderer", () => {
    const { output, unknown } = formatHelp("getClassInformation");
    expect(unknown).toBe(false);
    expect(output).toMatch(/^getClassInformation — browsing/);
    expect(output).toContain("Parameters:");
    expect(output).toContain("Returns:");
  });
});

describe("formatHelp — meta-command detail", () => {
  it("accepts the topic with or without a leading colon", () => {
    const withColon = formatHelp(":load");
    const withoutColon = formatHelp("load");
    expect(withColon.unknown).toBe(false);
    expect(withoutColon.unknown).toBe(false);
    expect(withColon.output).toContain(":load");
    expect(withoutColon.output).toContain(":load");
  });
});

describe("formatHelp — unknown topic", () => {
  it("returns unknown=true with an informative message", () => {
    const { output, unknown } = formatHelp("definitelyNotAThing");
    expect(unknown).toBe(true);
    expect(output).toContain("definitelyNotAThing");
    expect(output).toContain(":help");
  });
});
