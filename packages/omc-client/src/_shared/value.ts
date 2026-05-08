/**
 * Recursive Zod schema mirroring the discriminated `Value` union from
 * `parse.ts`. Used by API functions whose OMC return is a Value tree
 * (icon/diagram annotations, component annotations, etc.).
 */

import { z } from "zod";

import type { Value } from "../parse.js";

export const ValueSchema: z.ZodType<Value> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("string"), value: z.string() }),
    z.object({ kind: z.literal("bool"), value: z.boolean() }),
    z.object({ kind: z.literal("int"), value: z.number() }),
    z.object({ kind: z.literal("float"), value: z.number() }),
    z.object({ kind: z.literal("ident"), name: z.string() }),
    z.object({ kind: z.literal("list"), items: z.array(ValueSchema) }),
    z.object({
      kind: z.literal("call"),
      name: z.string(),
      args: z.array(ValueSchema),
    }),
    z.object({
      kind: z.literal("kwarg"),
      name: z.string(),
      value: ValueSchema,
    }),
    z.object({ kind: z.literal("null") }),
  ]),
);
