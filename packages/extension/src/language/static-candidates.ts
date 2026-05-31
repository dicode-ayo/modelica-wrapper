/**
 * Static completion channels: Modelica keywords, built-in types, and code
 * snippets. These are constant data — no OMC round-trip — routed by the cursor
 * context in {@link computeCompletions}:
 *
 *   - keywords + snippets  → element/statement position (a fresh word starting a
 *     declaration or statement), never after a `.` or in a value position.
 *   - built-in types       → merged into type / `extends` / component-type
 *     position alongside the OMC class names.
 *
 * The snippet `insertText` uses VSCode's `SnippetString` placeholder syntax
 * (`${1:name}`, `$0`); the thin provider wraps it in a `SnippetString`.
 */

import {
  CompletionCandidateKind,
  type CompletionCandidate,
} from "./completion-provider.js";

/**
 * Modelica reserved words offered in element/statement position. Excludes the
 * built-in type names (offered as {@link BUILT_IN_TYPES}) and literals
 * (`true`/`false`) that aren't completion-worthy as standalone words.
 */
export const MODELICA_KEYWORDS: readonly string[] = [
  "algorithm",
  "annotation",
  "block",
  "connector",
  "constant",
  "discrete",
  "each",
  "else",
  "elseif",
  "elsewhen",
  "encapsulated",
  "end",
  "enumeration",
  "equation",
  "expandable",
  "extends",
  "external",
  "final",
  "flow",
  "for",
  "function",
  "if",
  "import",
  "in",
  "initial",
  "inner",
  "input",
  "loop",
  "model",
  "operator",
  "outer",
  "output",
  "package",
  "parameter",
  "partial",
  "protected",
  "public",
  "record",
  "redeclare",
  "replaceable",
  "stream",
  "then",
  "type",
  "when",
  "while",
  "within",
];

/** The four predefined Modelica types, offered in type position. */
export const BUILT_IN_TYPES: readonly string[] = [
  "Real",
  "Integer",
  "Boolean",
  "String",
];

/** A code snippet: its trigger label and the `SnippetString`-syntax body. */
interface SnippetSpec {
  readonly label: string;
  readonly body: string;
}

/**
 * Class / control-flow templates offered in element/statement position. The
 * bodies use `SnippetString` placeholder syntax.
 */
export const CODE_SNIPPETS: readonly SnippetSpec[] = [
  { label: "model", body: "model ${1:Name}\n  $0\nend ${1:Name};" },
  { label: "block", body: "block ${1:Name}\n  $0\nend ${1:Name};" },
  { label: "function", body: "function ${1:name}\n  $0\nend ${1:name};" },
  { label: "record", body: "record ${1:Name}\n  $0\nend ${1:Name};" },
  { label: "package", body: "package ${1:Name}\n  $0\nend ${1:Name};" },
  { label: "connector", body: "connector ${1:Name}\n  $0\nend ${1:Name};" },
  { label: "for", body: "for ${1:i} loop\n  $0\nend for;" },
  { label: "while", body: "while ${1:cond} loop\n  $0\nend while;" },
  { label: "if", body: "if ${1:cond} then\n  $0\nend if;" },
  { label: "when", body: "when ${1:cond} then\n  $0\nend when;" },
];

/** Built-in type names as Class candidates, for the type-position merge. */
export function builtInTypeCandidates(): CompletionCandidate[] {
  return BUILT_IN_TYPES.map((label) => ({
    label,
    kind: CompletionCandidateKind.Class,
  }));
}

/** Modelica keywords as Keyword candidates, for element/statement position. */
export function keywordCandidates(): CompletionCandidate[] {
  return MODELICA_KEYWORDS.map((label) => ({
    label,
    kind: CompletionCandidateKind.Keyword,
  }));
}

/**
 * Code snippets as Snippet candidates, for element/statement position. The
 * `insertText` carries `SnippetString` syntax; the provider must wrap it so the
 * placeholders are honoured rather than inserted literally.
 */
export function snippetCandidates(): CompletionCandidate[] {
  return CODE_SNIPPETS.map(({ label, body }) => ({
    label,
    kind: CompletionCandidateKind.Snippet,
    insertText: body,
    isSnippet: true,
  }));
}
