/**
 * Renderer-agnostic model for the auto-generated interface sections shown
 * around a class's `Documentation(info=…)` HTML — the "Extends from" tree, the
 * parameter table, and the connector table OMEdit's generated docs display.
 *
 * These are plain, JSON-serializable rows. The host derives them from a
 * `getModelInstance` tree and sends them over the webview protocol;
 * `<om-documentation-interface>` renders them read-only. Kept in
 * `documentation-ui` (not `omc-client`) so the pure renderer owns its own
 * data contract, mirroring `InfoParts`.
 */

/** One parameter row: the display facts of a `parameter`-variability field. */
export interface DocParameterRow {
  /** Relative parameter name (e.g. `k`). */
  name: string;
  /** The declaration comment, when it has one. */
  description?: string | undefined;
  /** Pre-rendered default/value string; empty when neither source has one. */
  value: string;
  /** Base unit (e.g. `rad`), when the declaration carries one. */
  unit?: string | undefined;
  /** Dialog group the parameter is filed under (spec default `Parameters`). */
  group: string;
}

/** One connector row: name, type, and description of a connector component. */
export interface DocConnectorRow {
  /** Connector instance name (e.g. `u`, `y`). */
  name: string;
  /** The declaration comment, when it has one. */
  description?: string | undefined;
  /** Leaf name of the connector type (e.g. `RealInput`). */
  typeName: string;
  /** Causality when the declaration marks one. */
  direction?: "input" | "output" | undefined;
}

/** A node in the `extends` inheritance tree; `children` are its own bases. */
export interface DocExtendsNode {
  /** Qualified base-class name (e.g. `Modelica.Blocks.Interfaces.SISO`). */
  name: string;
  /** The base class's description comment, when it has one. */
  comment?: string | undefined;
  children: DocExtendsNode[];
}

/** The three auto-generated interface sections for a class. */
export interface DocumentationInterface {
  extendsTree: DocExtendsNode[];
  parameters: DocParameterRow[];
  connectors: DocConnectorRow[];
}

/** True when at least one section has content worth rendering. */
export function hasInterfaceSections(
  model: DocumentationInterface | undefined,
): model is DocumentationInterface {
  return (
    model !== undefined &&
    (model.extendsTree.length > 0 ||
      model.parameters.length > 0 ||
      model.connectors.length > 0)
  );
}
