/**
 * @modelica-wrapper/result-ui
 *
 * Standalone Lit + ECharts custom elements (`<om-*>`) for the postprocessing /
 * results view — a collection of `.mat` results overlaid on plot cards. Kept
 * deliberately independent of `diagram-ui` (no Babylon) so it can be bundled and
 * distributed on its own. See `docs/postprocessing-design.md`.
 */

export const PACKAGE_NAME = "@modelica-wrapper/result-ui";

export { buildVariableTree, type VarNode } from "./var-tree.js";
