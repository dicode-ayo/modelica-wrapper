/**
 * The custom-editor viewTypes. Kept in their own module so both the provider
 * and `openDiagram` can reference them without an import cycle.
 */
export const DIAGRAM_VIEW_TYPE = "modelica.diagram";

/** The `modelica.icon` custom-editor viewType — a class's own icon annotation. */
export const ICON_VIEW_TYPE = "modelica.icon";

/**
 * The `modelica.documentation` custom-editor viewType — a class's
 * `Documentation(info=…)` HTML.
 */
export const DOCUMENTATION_VIEW_TYPE = "modelica.documentation";

/**
 * Which graphics a provider instance renders: `"diagram"` shows the component
 * graph (`fetchDiagramLayout`), `"icon"` shows the class's own icon layers
 * (`fetchIconLayout`). The layout's `kind` discriminant drives the webview.
 */
export type DiagramMode = "diagram" | "icon";
