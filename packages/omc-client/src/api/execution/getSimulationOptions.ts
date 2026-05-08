/**
 * OMC: `function getSimulationOptions`
 *
 * Returns the startTime, stopTime, tolerance, numberOfIntervals, and interval
 * declared by the class's `experiment` annotation, falling back to the
 * `default*` inputs when the annotation is absent or partial.
 *
 * ```modelica
 * function getSimulationOptions
 *   input TypeName name;
 *   input Real defaultStartTime = 0.0;
 *   input Real defaultStopTime = 1.0;
 *   input Real defaultTolerance = 1e-6;
 *   input Integer defaultNumberOfIntervals = 500;
 *   input Real defaultInterval = 0.0;
 *   output Real startTime;
 *   output Real stopTime;
 *   output Real tolerance;
 *   output Integer numberOfIntervals;
 *   output Real interval;
 * end getSimulationOptions;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import {
  asFloat,
  asInt,
  expectList,
  parse,
  type Value,
} from "../../parse.js";

export const GetSimulationOptionsInputSchema = z.object({
  typeName: z.string().describe("Class whose experiment annotation is read."),
  defaultStartTime: z.number().optional().default(0.0).describe("Fallback startTime if the experiment annotation has none."),
  defaultStopTime: z.number().optional().default(1.0).describe("Fallback stopTime if the experiment annotation has none."),
  defaultTolerance: z.number().optional().default(1e-6).describe("Fallback tolerance if the experiment annotation has none."),
  defaultNumberOfIntervals: z.number().int().optional().default(500).describe("Fallback numberOfIntervals if the experiment annotation has none."),
  defaultInterval: z.number().optional().default(0.0).describe("Fallback interval if the experiment annotation has none."),
});
export type GetSimulationOptionsInput = z.input<
  typeof GetSimulationOptionsInputSchema
>;

export const GetSimulationOptionsOutputSchema = z.object({
  startTime: z.number().describe("Resolved simulation start time."),
  stopTime: z.number().describe("Resolved simulation stop time."),
  tolerance: z.number().describe("Resolved solver tolerance."),
  numberOfIntervals: z.number().int().describe("Resolved number of output intervals."),
  interval: z.number().describe("Resolved output interval (`(stopTime-startTime)/numberOfIntervals` when zero)."),
});
export type GetSimulationOptionsOutput = z.infer<
  typeof GetSimulationOptionsOutputSchema
>;

export const GetSimulationOptionsDescription =
  "Return the startTime, stopTime, tolerance, numberOfIntervals, and interval based on the class's experiment annotation (with caller-supplied fallbacks).";

export async function getSimulationOptions(
  ctx: CallContext,
  input: GetSimulationOptionsInput,
): Promise<GetSimulationOptionsOutput> {
  const raw = await ctx.call(
    `getSimulationOptions(${input.typeName}, ${input.defaultStartTime ?? 0.0}, ${input.defaultStopTime ?? 1.0}, ${input.defaultTolerance ?? 1e-6}, ${input.defaultNumberOfIntervals ?? 500}, ${input.defaultInterval ?? 0.0})`,
  );
  const items = expectList(parse(raw));
  if (items.length < 5) {
    throw new Error(
      `getSimulationOptions: got ${items.length} fields, want 5`,
    );
  }
  const at = (i: number): Value => items[i] as Value;
  return parseOutput(
    GetSimulationOptionsOutputSchema,
    {
      startTime: asFloat(at(0)) ?? 0,
      stopTime: asFloat(at(1)) ?? 0,
      tolerance: asFloat(at(2)) ?? 0,
      numberOfIntervals: asInt(at(3)) ?? 0,
      interval: asFloat(at(4)) ?? 0,
    },
    "getSimulationOptions",
  );
}
