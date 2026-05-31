/**
 * OMC: `function extendsFrom`
 *
 * Returns true if the given class extends from the given base class.
 *
 * NOTE on OMC 1.26.7 behaviour: this predicate matches `baseClassName`
 * against the class's *directly-listed* `extends` clauses (compared as
 * fully-qualified names) and is NOT transitive — given a chain `A <- B <- C`,
 * `extendsFrom(C, B)` is true but `extendsFrom(C, A)` is false. To test a
 * transitive relationship, walk `getInheritedClasses` (or query
 * `getAllSubtypeOf(base)` which IS transitive). Verified against OMC 1.26.7.
 *
 * ```modelica
 * function extendsFrom
 *   input TypeName className;
 *   input TypeName baseClassName;
 *   output Boolean res;
 * end extendsFrom;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const ExtendsFromInputSchema = z.object({
  typeName: z
    .string()
    .describe(
      "Fully qualified TypeName of the child class to test (OMC parameter `className`); emitted bare to OMC.",
    ),
  baseClassName: z
    .string()
    .describe(
      "Fully qualified TypeName of the base class to test against; emitted bare to OMC.",
    ),
});
export type ExtendsFromInput = z.input<typeof ExtendsFromInputSchema>;

export const ExtendsFromOutputSchema = z.object({
  res: z
    .boolean()
    .describe(
      "True if `className` extends from `baseClassName`; field name `res` is OMC verbatim.",
    ),
});
export type ExtendsFromOutput = z.infer<typeof ExtendsFromOutputSchema>;

export const ExtendsFromDescription =
  "Return true if the given class extends (transitively) from the given base class.";

export async function extendsFrom(
  ctx: CallContext,
  input: ExtendsFromInput,
): Promise<ExtendsFromOutput> {
  const raw = await ctx.call(
    `extendsFrom(${input.typeName}, ${input.baseClassName})`,
  );
  return parseOutput(
    ExtendsFromOutputSchema,
    { res: expectBool(parse(raw)) },
    "extendsFrom",
  );
}
