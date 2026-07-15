/**
 * @dicode/documentation-ui
 *
 * Standalone Lit + TipTap custom element (`<om-documentation-editor>`) for
 * editing a Modelica class's `Documentation(info="<html>…</html>")` HTML. Kept
 * deliberately independent of the VSCode webview API and of `omc-client`: it
 * takes `info` in and emits an `om-documentation-change` out, so the same
 * renderer serves the VSCode custom editor and a future web client.
 *
 * Importing the component re-export registers its custom element (the
 * `@customElement` decorator runs on module load).
 */

export const PACKAGE_NAME = "@dicode/documentation-ui";

// The event components emit.
export * from "./events.js";

// The canonical `Documentation(info=…)` schema + round-trip.
export { documentationExtensions } from "./documentation-schema.js";
export {
  splitInfoWrapper,
  wrapInfo,
  formatBody,
  canonicalizeInner,
  canonicalizeInfo,
  type InfoParts,
} from "./documentation-roundtrip.js";
export { prettyPrintHtml } from "./documentation-pretty.js";

// Components.
export { OmDocumentationEditor } from "./documentation-editor.component.js";
export { OmDocumentationInterface } from "./documentation-interface.component.js";

// The read-only interface-section model (extends tree, parameters, connectors).
export type {
  DocConnectorRow,
  DocExtendsNode,
  DocParameterRow,
  DocumentationInterface,
} from "./interface-model.js";
