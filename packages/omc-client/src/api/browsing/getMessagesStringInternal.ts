/**
 * OMC: `function getMessagesStringInternal`
 *
 * Returns the buffered OMC diagnostics as structured records instead of one
 * flat string. Use this when you need file/line/column information to render
 * positioned diagnostics (IDE squiggles, Problems panel entries, etc.).
 *
 * ```modelica
 * function getMessagesStringInternal
 *   input Boolean unique = true;
 *   output ErrorMessage[:] messagesString;
 * end getMessagesStringInternal;
 *
 * record ErrorMessage
 *   SourceInfo info;
 *   String message;
 *   ErrorKind kind;
 *   ErrorLevel level;
 *   Integer id;
 * end ErrorMessage;
 *
 * record SourceInfo
 *   String filename;
 *   Boolean readonly;
 *   Integer lineStart;
 *   Integer columnStart;
 *   Integer lineEnd;
 *   Integer columnEnd;
 * end SourceInfo;
 * ```
 *
 * Probe-verified shape on OMC 1.26.7: top-level response is a record array
 * `{rec, rec, ...}`. Each record is parsed by the existing `parse.ts` into a
 * Value of kind="call" whose name is the record type name (e.g.
 * `record OpenModelica.Scripting.ErrorMessage`) and whose args are kwargs
 * holding the record fields. Enum values like
 * `.OpenModelica.Scripting.ErrorKind.syntax` come back as ident Values whose
 * `name` is a dotted path — we slice the last segment for the user-facing
 * tag.
 *
 * The Zod `kind` and `level` fields use `z.string()` rather than `z.enum(...)`
 * because the OMC documentation lists more enum members than the probe
 * observed; we don't want a future variant (e.g. a new error class) to break
 * parsing. Callers that need narrow types can post-filter.
 *
 * Draining behavior: `getMessagesStringInternal` returns the buffered list
 * WITHOUT clearing it. To drain, call `getErrorString()` afterwards (or use
 * the `unique=true` semantics: messages are deduplicated by content).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import {
  asBool,
  asInt,
  asString,
  expectList,
  parse,
  type Value,
} from "../../parse.js";

export const GetMessagesStringInternalInputSchema = z.object({
  unique: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "When true, OMC deduplicates messages with identical content; when false, every emission is returned.",
    ),
});
export type GetMessagesStringInternalInput = z.input<
  typeof GetMessagesStringInternalInputSchema
>;

/**
 * One structured diagnostic from OMC's error buffer.
 *
 * `kind` matches the documented ErrorKind enum (`syntax`, `grammar`,
 * `translation`, `symbolic`, `simulation`, `scripting`, `runtime`) but is
 * typed as `string` to tolerate undocumented variants OMC may emit; the
 * common values listed in the OMC docs are
 * `syntax | grammar | translation | symbolic | simulation | scripting | runtime`.
 *
 * `level` matches ErrorLevel (`internal | error | warning | notification`)
 * with the same defensive widening.
 */
export const ErrorMessageSchema = z.object({
  info: z.object({
    filename: z.string().describe("Source filename associated with the diagnostic. `<interactive>` for in-memory sources."),
    readonly: z.boolean().describe("True when OMC considers the source file read-only."),
    lineStart: z.number().int().describe("First affected line (1-based)."),
    columnStart: z.number().int().describe("First affected column (1-based)."),
    lineEnd: z.number().int().describe("Last affected line (1-based)."),
    columnEnd: z.number().int().describe("Last affected column (1-based)."),
  }),
  message: z.string().describe("User-readable diagnostic text."),
  kind: z
    .string()
    .describe(
      "ErrorKind tag. Common values per OMC docs: syntax, grammar, translation, symbolic, simulation, scripting, runtime. Typed as string for forward-compat with undocumented variants.",
    ),
  level: z
    .string()
    .describe(
      "ErrorLevel tag. Common values per OMC docs: internal, error, warning, notification. Typed as string for forward-compat.",
    ),
  id: z.number().int().describe("Numeric OMC error id."),
});
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

export const GetMessagesStringInternalOutputSchema = z.object({
  messages: z
    .array(ErrorMessageSchema)
    .describe("Buffered diagnostic records, oldest first."),
});
export type GetMessagesStringInternalOutput = z.infer<
  typeof GetMessagesStringInternalOutputSchema
>;

export const GetMessagesStringInternalDescription =
  "Return OMC's buffered diagnostics as structured records (file/line/col + kind/level/message) for IDE-style positioned reporting.";

/** Extract the final segment of a dotted ident — `.A.B.foo` → `foo`. */
function lastSegment(s: string): string {
  const trimmed = s.startsWith(".") ? s.slice(1) : s;
  const idx = trimmed.lastIndexOf(".");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/** Coerce a Value to string, treating enum-style idents as their last segment. */
function fieldAsString(v: Value | undefined): string {
  if (!v) return "";
  if (v.kind === "string") return v.value;
  if (v.kind === "ident") return lastSegment(v.name);
  return asString(v) ?? "";
}

function fieldAsBool(v: Value | undefined): boolean {
  if (!v) return false;
  return asBool(v) ?? false;
}

function fieldAsInt(v: Value | undefined): number {
  if (!v) return 0;
  return asInt(v) ?? 0;
}

/**
 * Extract `name → value` pairs from a record's kwarg-style args.
 *
 * OMC records render as `record TypeName field1 = v1; field2 = v2; ... end TypeName;`
 * in the docs but on the wire come back as `Type(field1=v1, field2=v2)` —
 * which our parser represents as a `call` with `kwarg` items. Some OMC
 * versions also emit `record OpenModelica.Scripting.ErrorMessage(...)` where
 * the parser names the call after the full record path; we don't depend on
 * the name, only on the kwarg children.
 */
function fieldsOf(rec: Value): Map<string, Value> {
  const out = new Map<string, Value>();
  if (rec.kind !== "call") return out;
  for (const arg of rec.args) {
    if (arg.kind === "kwarg") {
      out.set(arg.name, arg.value);
    }
  }
  return out;
}

export async function getMessagesStringInternal(
  ctx: CallContext,
  input: GetMessagesStringInternalInput = {},
): Promise<GetMessagesStringInternalOutput> {
  const unique = input.unique ?? true;
  const raw = await ctx.call(`getMessagesStringInternal(${mlBool(unique)})`);
  const parsed = parse(raw);
  // Empty buffer comes back as `{}` → list with no items, or `null` on some
  // OMC versions. Both map to an empty array.
  if (parsed.kind === "null") {
    return parseOutput(
      GetMessagesStringInternalOutputSchema,
      { messages: [] },
      "getMessagesStringInternal",
    );
  }
  const items = expectList(parsed);
  const messages = items.map((rec) => {
    const f = fieldsOf(rec);
    const info = f.get("info");
    const infoFields = info ? fieldsOf(info) : new Map<string, Value>();
    return {
      info: {
        filename: fieldAsString(infoFields.get("filename")),
        readonly: fieldAsBool(infoFields.get("readonly")),
        lineStart: fieldAsInt(infoFields.get("lineStart")),
        columnStart: fieldAsInt(infoFields.get("columnStart")),
        lineEnd: fieldAsInt(infoFields.get("lineEnd")),
        columnEnd: fieldAsInt(infoFields.get("columnEnd")),
      },
      message: fieldAsString(f.get("message")),
      kind: fieldAsString(f.get("kind")),
      level: fieldAsString(f.get("level")),
      id: fieldAsInt(f.get("id")),
    };
  });
  return parseOutput(
    GetMessagesStringInternalOutputSchema,
    { messages },
    "getMessagesStringInternal",
  );
}
