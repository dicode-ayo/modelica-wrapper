// @vitest-environment happy-dom
//
// The canonical round-trip is the crux of the documentation editor: the source
// annotation must only ever be rewritten in a form that survives being rewritten
// again, or every save would churn the diff. These pin that against a corpus of
// real MSL `Documentation(info=…)` strings (fetched from OMC, under
// `__fixtures__/doc-info`): canonicalizing is a fixed point, the `<html>` wrapper
// is preserved verbatim, and the Modelica-specific bits (`modelica://` links and
// resource images, tables) survive the schema.
//
// `@tiptap/html` needs a DOM, so this file runs under happy-dom rather than the
// suite's default node environment.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  canonicalizeInfo,
  splitInfoWrapper,
  wrapInfo,
} from "./documentation-roundtrip.js";

const FIXTURE_DIR = "src/webview/__fixtures__/doc-info";

function corpus(): { name: string; info: string }[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".html"))
    .map((f) => ({
      name: f,
      // OMC appends a trailing newline when writing the string to disk; it is
      // not part of the annotation value.
      info: readFileSync(`${FIXTURE_DIR}/${f}`, "utf8").replace(/\n$/, ""),
    }));
}

describe("documentation round-trip corpus", () => {
  const fixtures = corpus();

  it("loads a non-empty corpus", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)("canonicalizing $name is a fixed point", ({ info }) => {
    const once = canonicalizeInfo(info);
    expect(canonicalizeInfo(once)).toBe(once);
  });

  it.each(fixtures)("reassembles $name wrapper verbatim", ({ info }) => {
    const parts = splitInfoWrapper(info);
    expect(wrapInfo(parts.inner, parts)).toBe(info);
  });

  it.each(fixtures)("keeps the $name inside its <html> wrapper", ({ info }) => {
    const once = canonicalizeInfo(info);
    expect(once).toMatch(/^<html>/);
    expect(once.trimEnd()).toMatch(/<\/html>$/);
  });
});

describe("documentation round-trip preservation", () => {
  function read(name: string): string {
    return readFileSync(`${FIXTURE_DIR}/${name}`, "utf8").replace(/\n$/, "");
  }

  it("keeps a modelica:// cross-reference link", () => {
    expect(canonicalizeInfo(read("pid.html"))).toContain(
      'href="modelica://Modelica.Blocks.Types.Init"',
    );
  });

  it("keeps a table", () => {
    expect(canonicalizeInfo(read("pid.html"))).toContain("<table");
  });

  it("keeps a modelica:// resource image with its alt text", () => {
    const once = canonicalizeInfo(read("step.html"));
    expect(once).toContain(
      'src="modelica://Modelica/Resources/Images/Blocks/Sources/Step.png"',
    );
    expect(once).toContain('alt="Step.png"');
  });
});

describe("splitInfoWrapper", () => {
  it("splits around the wrapper and preserves attributes on it", () => {
    const parts = splitInfoWrapper("<html>\n<p>x</p>\n</html>");
    expect(parts.prefix).toBe("<html>");
    expect(parts.inner).toBe("\n<p>x</p>\n");
    expect(parts.suffix).toBe("</html>");
  });

  it("treats a wrapper-less string as all-inner and reassembles unchanged", () => {
    const parts = splitInfoWrapper("plain text");
    expect(parts).toEqual({ prefix: "", inner: "plain text", suffix: "" });
    expect(wrapInfo(parts.inner, parts)).toBe("plain text");
  });
});
