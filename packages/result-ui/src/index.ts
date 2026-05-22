/**
 * @modelica-wrapper/result-ui
 *
 * Standalone Lit + ECharts custom elements (`<om-*>`) for the postprocessing /
 * results view — a collection of `.mat` results overlaid on plot cards. Kept
 * deliberately independent of `diagram-ui` (no Babylon) and of `omc-client` (it
 * owns its render-side view model in `types.ts`), so it can be bundled and
 * distributed on its own. See `docs/postprocessing-design.md`.
 *
 * Importing a component re-export registers its custom element (the
 * `@customElement` decorator runs on module load).
 */

export const PACKAGE_NAME = "@modelica-wrapper/result-ui";

// Render-side view model + the events components emit.
export * from "./types.js";
export * from "./events.js";

// Pure helpers (also unit-tested in isolation).
export { buildVariableTree, type VarNode } from "./var-tree.js";
export { buildEchartTheme, readCssVar, type EchartTheme } from "./echart-theme.js";
export { buildLineChartOption } from "./chart-option.js";

// Components.
export { OmResultViewApp } from "./result-view-app.component.js";
export { OmResultsDrawer } from "./results-drawer.component.js";
export { OmCardsList } from "./cards-list.component.js";
export { OmResultPlotCard } from "./result-plot-card.component.js";
export { OmAddTraceRow } from "./add-trace-row.component.js";
