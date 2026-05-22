/**
 * @modelica-wrapper/ui-common
 *
 * Shared UI foundation for the `<om-*>` webviews — design tokens and the
 * Web Awesome → VSCode theme bridge — depended on by both `diagram-ui` (the
 * diagram editor) and `result-ui` (the postprocessing view). It carries no
 * Babylon and no OMC dependency, so either UI can use it without inheriting
 * the other's weight.
 *
 * - `omTokens` — the `--om-*` design-token sheet, dropped into a component's
 *   `static styles`.
 * - `./webawesome-setup` — the global Web Awesome theme + VSCode bridge
 *   bootstrap (side-effect import at app startup).
 */

export const PACKAGE_NAME = "@modelica-wrapper/ui-common";

export { omTokens } from "./om-tokens.js";
