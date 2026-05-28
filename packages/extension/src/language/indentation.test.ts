/**
 * Regression tests for the `indentationRules` in `language-configuration.json`.
 *
 * The `increaseIndentPattern` is a single dense regex that classifies whether a
 * line opens a new indentation block. It churned across several review rounds —
 * `parameter` (a component prefix, not a block opener) misfired, one-line
 * short-class definitions (`type T = Real;`) false-positived, and
 * `replaceable`/`redeclare` class declarations were initially missed. Each was
 * fixed by eye against an ad-hoc table; this locks that table in so the next
 * edit to the regex can't silently reintroduce a regression.
 *
 * The test loads the *actual* JSON the extension ships (not a copy of the
 * pattern) and compiles its regexes the same way VSCode does (no flags, so `$`
 * anchors to the end of the single line under test).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, "..", "..", "language-configuration.json");

interface LanguageConfiguration {
  readonly indentationRules: {
    readonly increaseIndentPattern: string;
    readonly decreaseIndentPattern: string;
  };
}

/**
 * Narrow `unknown` to {@link LanguageConfiguration} so the regression net
 * catches structural drift too — not just regex contents. Without this,
 * removing `indentationRules` from `language-configuration.json` produces an
 * opaque "cannot read property … of undefined" rather than a clear shape error.
 */
function isLanguageConfiguration(
  value: unknown,
): value is LanguageConfiguration {
  if (typeof value !== "object" || value === null) return false;
  const rules = (value as { indentationRules?: unknown }).indentationRules;
  if (typeof rules !== "object" || rules === null) return false;
  const { increaseIndentPattern, decreaseIndentPattern } = rules as {
    increaseIndentPattern?: unknown;
    decreaseIndentPattern?: unknown;
  };
  return (
    typeof increaseIndentPattern === "string" &&
    typeof decreaseIndentPattern === "string"
  );
}

const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
if (!isLanguageConfiguration(parsed)) {
  throw new Error(
    `language-configuration.json no longer has the expected indentationRules shape`,
  );
}
const config = parsed;

const increaseIndent = new RegExp(
  config.indentationRules.increaseIndentPattern,
);
const decreaseIndent = new RegExp(
  config.indentationRules.decreaseIndentPattern,
);

describe("increaseIndentPattern", () => {
  const opensBlock: string[] = [
    // Class definitions, with and without leading indentation.
    "model M",
    "  model M",
    "class C",
    "connector C",
    "block B",
    "record R",
    "package P",
    "function F",
    'model M "a documented model"',
    // Class prefixes stack before the class keyword.
    "partial model M",
    "encapsulated package P",
    "replaceable model M",
    "redeclare model M",
    "replaceable partial model M",
    // Control flow that ends in `then`/`loop`.
    "if cond then",
    "elseif other then",
    "when cond then",
    "while cond loop",
    "for i in 1:n loop",
    // Sections.
    "equation",
    "algorithm",
    "public",
    "protected",
    "else",
    "initial equation",
    "initial algorithm",
  ];

  const doesNotOpenBlock: string[] = [
    // `parameter` is a component prefix, not a block opener (the original bug).
    "parameter Real x = 1;",
    "Real y = p;",
    "Resistor r;",
    // One-line short-class / declaration forms (have `=` or end in `;`).
    "type T = Real;",
    "connector C = Real;",
    // A class prefix without a following class keyword is a component use.
    "replaceable Resistor r;",
    // Closers and one-liners never increase.
    "end M;",
    "end if;",
    "annotation(Icon());",
    // Control flow that doesn't end in then/loop (a one-line `if`).
    "if cond then y = 1; end if;",
    // Section keywords only when alone on the line.
    "equation x = 1;",
  ];

  it.each(opensBlock)("increases indent after %j", (line) => {
    expect(increaseIndent.test(line)).toBe(true);
  });

  it.each(doesNotOpenBlock)("does not increase indent after %j", (line) => {
    expect(increaseIndent.test(line)).toBe(false);
  });
});

describe("decreaseIndentPattern", () => {
  const dedents: string[] = [
    "end M;",
    "  end M;",
    "end if;",
    "else",
    "elseif x then",
    "elsewhen x then",
    "}",
    ")",
    "]",
  ];

  const keepsIndent: string[] = ["model M", "Real x = 1;", "equation"];

  it.each(dedents)("decreases indent on %j", (line) => {
    expect(decreaseIndent.test(line)).toBe(true);
  });

  it.each(keepsIndent)("does not decrease indent on %j", (line) => {
    expect(decreaseIndent.test(line)).toBe(false);
  });
});
