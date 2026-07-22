import type { ParameterFormKind } from "./protocol.js";

/**
 * Whether the parameter panel should render read-only.
 *
 * A read-only class (a system library) blocks the source-mutating forms
 * (`classParams`/`componentParams`/`shapeProperties`), but the `simulate` form
 * only runs the model and emits a result file — it never writes source — so it
 * stays usable. Mirrors the host's `kind === "simulate"` short-circuit ahead of
 * its read-only gate.
 */
export function panelReadonly(
  readOnly: boolean,
  kind: ParameterFormKind | null,
): boolean {
  return readOnly && kind !== "simulate";
}
