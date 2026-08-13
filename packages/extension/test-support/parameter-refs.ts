/**
 * Shared `ParameterRef` lookup for parameter-edits tests — `=== undefined`
 * narrowing instead of a truthiness guard (CLAUDE.md convention).
 */

import type {
  ParameterFormState,
  ParameterRef,
} from "../src/diagram/parameter-edits.js";

export function refOf(form: ParameterFormState, name: string): ParameterRef;
export function refOf(
  refs: Record<string, ParameterRef>,
  name: string,
): ParameterRef;
export function refOf(
  source: ParameterFormState | Record<string, ParameterRef>,
  name: string,
): ParameterRef {
  const refs = "model" in source ? source.refs : source;
  const ref = refs[name];
  if (ref === undefined) throw new Error(`expected ref '${name}'`);
  return ref;
}
