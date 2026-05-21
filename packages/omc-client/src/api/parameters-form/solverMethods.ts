/**
 * The integration-method (`-s` / `--solver`) value set OMC's `simulate`
 * accepts for its `method` argument — the source of truth for the simulate
 * panel's `method` dropdown.
 *
 * This is a maintained CONSTANT, not a fallback for a failing scripting call:
 * OMC 1.26.7 exposes no scripting API that returns this list. The functions
 * one would reach for — `getSolverMethods`, `getNonLinearSolvers`,
 * `getLinearSolvers`, `getInitializationMethods`, `getJacobianMethods` — do
 * NOT exist in OMC's scripting scope (probed live against 1.26.7: they are
 * absent from `getClassNames(OpenModelica.Scripting)` and calling one yields
 * `Error: Class getSolverMethods not found in scope`). See
 * `docs/parameter-model-design.md` (Revision 2026-05-21, "Investigation —
 * `getSolverMethods` is a phantom function").
 *
 * The values mirror OMC's documented `-s/--solver` flag. `"<default>"` is the
 * sentinel that lets OMC pick (it maps to {@link DEFAULT_SOLVER_METHOD}); it is
 * kept as the last entry so the form can offer "let OMC decide" alongside the
 * explicit methods.
 *
 * Lives in the `parameters-form/` namespace (NOT `api/execution/`) so it is a
 * pure constant the producer can consume without adding an OMC wrapper to the
 * coverage count.
 */

/** OMC's documented `-s/--solver` value set, plus the `"<default>"` sentinel. */
export const SOLVER_METHODS = [
  "dassl",
  "ida",
  "cvode",
  "gbode",
  "euler",
  "rungekutta",
  "symSolver",
  "symSolverSsc",
  "qss",
  "optimization",
  "<default>",
] as const;

/** A single member of {@link SOLVER_METHODS}. */
export type SolverMethod = (typeof SOLVER_METHODS)[number];

/**
 * OMC's default solver when `method` is left at `"<default>"`. Used to seed the
 * simulate form's `method` field so the dropdown shows a concrete selection
 * rather than the sentinel.
 */
export const DEFAULT_SOLVER_METHOD = "dassl" as const;

/**
 * The on-disk result-file formats OMC's `simulate` accepts for its
 * `outputFormat` argument. A small fixed OMC set (there is no scripting API for
 * it either); `"mat"` is the default.
 */
export const OUTPUT_FORMATS = ["mat", "csv", "plt", "empty"] as const;

/** A single member of {@link OUTPUT_FORMATS}. */
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** OMC's default `outputFormat`. */
export const DEFAULT_OUTPUT_FORMAT = "mat" as const;
