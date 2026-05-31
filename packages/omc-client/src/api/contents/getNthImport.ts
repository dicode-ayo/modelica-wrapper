/**
 * OMC: `function getNthImport`
 *
 * Returns the n-th `import`-clause from a class as `[path, id, kind]`.
 *
 * ```modelica
 * function getNthImport
 *   input TypeName class_;
 *   input Integer index;
 *   output String out[3] "{\"Path\",\"Id\",\"Kind\"}";
 * end getNthImport;
 * ```
 *
 * The OMC `output String out[3]` documents a fixed-shape 3-tuple: the
 * imported path, the (possibly empty) local identifier of a renamed
 * `import M = Foo` clause, and the kind tag (`unqualified` for `import F.*;`
 * etc.). Wrapper field names are OMC-verbatim (lowercased): `path`, `id`,
 * `kind`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetNthImportInputSchema = z.object({
  typeName: z
    .string()
    .describe(
      'Fully qualified Modelica TypeName (e.g. "Modelica.Blocks.Examples.PID_Controller"); emitted bare to OMC.',
    ),
  index: z
    .number()
    .int()
    .positive()
    .describe("1-based import-clause index, between 1 and `getImportCount`."),
});
export type GetNthImportInput = z.input<typeof GetNthImportInputSchema>;

export const GetNthImportOutputSchema = z.object({
  path: z
    .string()
    .describe(
      "Imported path, e.g. `Modelica.SIunits` for `import Modelica.SIunits;` or `Modelica` for `import M = Modelica;`.",
    ),
  id: z
    .string()
    .describe(
      "Local identifier of a renamed `import M = Foo;` clause; empty string for plain or unqualified imports.",
    ),
  kind: z
    .string()
    .describe(
      "Import-clause kind tag (e.g. `unqualified` for `import F.*;`); OMC-verbatim string.",
    ),
});
export type GetNthImportOutput = z.infer<typeof GetNthImportOutputSchema>;

export const GetNthImportDescription =
  "Return the n-th `import`-clause from a class as `(path, id, kind)`.";

export async function getNthImport(
  ctx: CallContext,
  input: GetNthImportInput,
): Promise<GetNthImportOutput> {
  const raw = await ctx.call(`getNthImport(${input.typeName}, ${input.index})`);
  const fields = expectStringList(parse(raw));
  if (fields.length < 3) {
    throw new Error(
      `getNthImport: got ${fields.length} fields, want 3 ([path, id, kind])`,
    );
  }
  return parseOutput(
    GetNthImportOutputSchema,
    {
      path: fields[0] ?? "",
      id: fields[1] ?? "",
      kind: fields[2] ?? "",
    },
    "getNthImport",
  );
}
