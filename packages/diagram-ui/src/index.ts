/**
 * @modelica-wrapper/diagram-ui
 *
 * Lit + Babylon.js custom elements (`<om-*>`) that render a Modelica
 * graphical layout inside the VSCode webview.
 *
 * Inputs:
 *   - `DiagramLayout` from `@modelica-wrapper/omc-client` (the producer
 *     output over `getModelInstance` JSON).
 *   - SVG icon strings from `@modelica-wrapper/diagram-svg`, rasterised
 *     into Babylon `Texture`s by the icon-provider (added in stage C).
 *
 * Composition:
 *   `<om-scene>` creates the Babylon engine and provides a parentNodeCtx
 *   (`TransformNode`). Each entity element (`<om-component>`,
 *   `<om-connector>`, `<om-edge>`, `<om-label>`, ...) is a thin
 *   Lit→Babylon bridge that consumes its parent node, creates one
 *   `TransformNode`, syncs Lit properties to Babylon state, and provides
 *   itself as the parent context to its own children.
 *
 * The public surface fills out as the B-stage commits land. For now this
 * is a scaffold that proves the package wires up via `pnpm -r typecheck`
 * and `pnpm -r test`.
 */

export const PACKAGE_NAME = "@modelica-wrapper/diagram-ui";
