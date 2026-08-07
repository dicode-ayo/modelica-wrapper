import type { ParameterFormKind } from "./protocol.js";

/**
 * Whether the parameter panel should render read-only.
 *
 * `readOnly` is the host's write verdict, transported over the protocol as a
 * boolean. It blocks the source-mutating forms
 * (`classParams`/`componentParams`/`shapeProperties`), but the `simulate` form
 * only runs the model and emits a result file — it never writes source — so it
 * stays usable. Mirrors the host's `kind === "simulate"` short-circuit ahead of
 * its own gate.
 */
export function panelReadonly(
  readOnly: boolean,
  kind: ParameterFormKind | null,
): boolean {
  return readOnly && kind !== "simulate";
}
