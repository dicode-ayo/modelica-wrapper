/**
 * ECharts colours derived from the live VSCode / `--om-*` CSS variables, so plots
 * pick up the editor theme instead of hardcoding any colour. Read once per chart
 * build (currently only when traces change); refreshing on a live theme switch is
 * the polish pass (#86). The `read` function is injectable so the pure option
 * builder can be unit-tested with a fixed theme.
 */

export interface EchartTheme {
  /** Axis labels, legend, tooltip text. */
  text: string;
  /** Axis lines. */
  axisLine: string;
  /** Grid split lines. */
  splitLine: string;
  /** Series colour cycle. */
  palette: string[];
}

/** Read a CSS custom property off `document.body`, falling back outside a DOM
 * (or when the var is unset) — mirrors `diagram-ui`'s `var(--vscode-…, #fb)`. */
export function readCssVar(name: string, fallback: string): string {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return fallback;
  }
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

export function buildEchartTheme(
  read: (name: string, fallback: string) => string = readCssVar,
): EchartTheme {
  return {
    text: read("--vscode-foreground", "#cccccc"),
    axisLine: read("--vscode-panel-border", "#454545"),
    splitLine: read("--vscode-panel-border", "#454545"),
    // VSCode's chart palette when present; a readable fallback set otherwise.
    palette: [
      read("--vscode-charts-blue", "#4e9bff"),
      read("--vscode-charts-red", "#f14c4c"),
      read("--vscode-charts-green", "#4caf50"),
      read("--vscode-charts-yellow", "#e2c08d"),
      read("--vscode-charts-purple", "#b180d7"),
      read("--vscode-charts-orange", "#d18616"),
    ],
  };
}
