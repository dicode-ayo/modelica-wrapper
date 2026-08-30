import type { ParameterRef } from "../src/diagram/parameter-edits.js";

export function refOf(
  refs: Record<string, ParameterRef>,
  name: string,
): ParameterRef {
  const ref = refs[name];
  if (ref === undefined) throw new Error(`expected ref '${name}'`);
  return ref;
}
