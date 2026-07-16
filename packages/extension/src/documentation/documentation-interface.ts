/**
 * Pure derivation of a class's auto-generated interface sections from its
 * `getModelInstance` tree — the "Extends from" tree, the parameter table, and
 * the connector table OMEdit's generated docs show around the `info` HTML.
 *
 * No OMC contact and no rendering: the caller fetches the `ModelInstance`, this
 * maps it to the renderer-agnostic `DocumentationInterface`, and the webview
 * renders it read-only. Parameters reuse `produceParameterModel` (the same walk
 * the diagram parameter form uses); connectors and the extends tree are walked
 * here. Unit dropdowns are irrelevant to a read-only view, so no `UnitTable` is
 * injected — the base `unit` string the producer already resolves is enough.
 */

import type {
  ComponentElement,
  ModelInstance,
  ParameterField,
} from "@dicode/omc-client";
import { produceParameterModel } from "@dicode/omc-client";
import { expressionToString } from "@dicode/diagram-svg";
import type {
  DocConnectorRow,
  DocExtendsNode,
  DocParameterRow,
  DocumentationInterface,
} from "@dicode/documentation-ui/interface-model";

export function buildDocumentationInterface(
  instance: ModelInstance,
): DocumentationInterface {
  return {
    extendsTree: buildExtendsTree(instance),
    parameters: buildParameterRows(instance),
    connectors: buildConnectorRows(instance),
  };
}

function buildParameterRows(instance: ModelInstance): DocParameterRow[] {
  return produceParameterModel(instance).fields.map((field) => {
    const row: DocParameterRow = {
      name: field.name,
      value: displayValue(field),
      group: field.dialog.group,
    };
    // `label` is the comment-else-name; carry it only when it's a real comment.
    if (field.label !== field.name) row.description = field.label;
    if (field.unit !== undefined) row.unit = field.unit;
    return row;
  });
}

/**
 * Render a parameter's resolved value for a read-only cell. A default the
 * producer could not coerce to a scalar (a cref, arithmetic, DynamicSelect)
 * falls back to stringifying the raw binding AST, as OMEdit does.
 */
function displayValue(field: ParameterField): string {
  const { value } = field;
  if (value !== null && value !== undefined) {
    if (typeof value !== "object") return String(value);
    return expressionToString(value);
  }
  return expressionToString(field.binding);
}

/**
 * Collect connector components across the class's own elements and its extends
 * ancestors (more-derived wins by name, matching Modelica flattening). A
 * connector is a component whose resolved type is a `connector`-restricted
 * class.
 */
function buildConnectorRows(instance: ModelInstance): DocConnectorRow[] {
  const rows: DocConnectorRow[] = [];
  const seen = new Set<string>();
  for (const el of walkComponents(instance)) {
    // A more-derived redeclaration (yielded first) claims the name for good,
    // even when it isn't itself a connector — matching Modelica flattening.
    if (seen.has(el.name)) continue;
    seen.add(el.name);
    if (!isConnector(el)) continue;
    const row: DocConnectorRow = {
      name: el.name,
      typeName: connectorTypeName(el),
    };
    if (el.comment !== undefined) row.description = el.comment;
    const direction = connectorDirection(el);
    if (direction !== undefined) row.direction = direction;
    rows.push(row);
  }
  return rows;
}

function isConnector(el: ComponentElement): boolean {
  const type = el.type;
  if (type === undefined || typeof type === "string") return false;
  return type.restriction === "connector";
}

function connectorTypeName(el: ComponentElement): string {
  const type = el.type;
  if (type === undefined) return "";
  const full = typeof type === "string" ? type : type.name;
  const leaf = full.split(".").at(-1);
  return leaf ?? full;
}

/**
 * Connector causality. OMC reports it in `prefixes.direction`;
 * `prefixes.connector` carries the connector keyword (`flow` / `stream`) on a
 * connector's inner variables, not the port's causality.
 */
function connectorDirection(
  el: ComponentElement,
): "input" | "output" | undefined {
  const raw = el.prefixes?.direction;
  return raw === "input" || raw === "output" ? raw : undefined;
}

/**
 * Own components first, then those reached through `extends`. `extends` clauses
 * conventionally precede components in the source, so yielding own components
 * ahead of the recursion lets the more-derived declaration win the by-name
 * dedup regardless of element order.
 */
function* walkComponents(mi: ModelInstance): Iterable<ComponentElement> {
  const elements = mi.elements ?? [];
  for (const el of elements) {
    if (el.$kind === "component") yield el;
  }
  for (const el of elements) {
    if (el.$kind === "extends" && typeof el.baseClass === "object") {
      yield* walkComponents(el.baseClass);
    }
  }
}

/** Build the `extends` inheritance tree; string (primitive) bases are skipped. */
function buildExtendsTree(mi: ModelInstance): DocExtendsNode[] {
  const nodes: DocExtendsNode[] = [];
  for (const el of mi.elements ?? []) {
    if (el.$kind !== "extends") continue;
    const base = el.baseClass;
    if (typeof base !== "object") continue;
    const node: DocExtendsNode = {
      name: base.name,
      children: buildExtendsTree(base),
    };
    if (base.comment !== undefined) node.comment = base.comment;
    nodes.push(node);
  }
  return nodes;
}
