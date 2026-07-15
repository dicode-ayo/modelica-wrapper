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
      label: field.label,
      value: displayValue(field.value),
      group: field.dialog.group,
    };
    if (field.unit !== undefined) row.unit = field.unit;
    if (field.inheritedFrom !== undefined)
      row.inheritedFrom = field.inheritedFrom;
    return row;
  });
}

/** Render a parameter's resolved value for a read-only cell. */
function displayValue(value: ParameterField["value"]): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return "";
  return String(value);
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
    if (seen.has(el.name)) continue;
    if (!isConnector(el)) continue;
    seen.add(el.name);
    const row: DocConnectorRow = {
      name: el.name,
      label: el.comment ?? el.name,
      typeName: connectorTypeName(el),
    };
    const direction = connectorDirection(el);
    if (direction !== undefined) row.direction = direction;
    rows.push(row);
  }
  return rows;
}

function isConnector(el: ComponentElement): boolean {
  const type = el.type;
  if (type === undefined || typeof type === "string") return false;
  return type.restriction.includes("connector");
}

function connectorTypeName(el: ComponentElement): string {
  const type = el.type;
  if (type === undefined) return "";
  const full = typeof type === "string" ? type : type.name;
  const leaf = full.split(".").at(-1);
  return leaf ?? full;
}

/**
 * Connector causality. OMC tags it on the component prefixes as `connector`
 * (`"input"` / `"output"`), with `direction` as the older spelling.
 */
function connectorDirection(
  el: ComponentElement,
): "input" | "output" | undefined {
  const raw = el.prefixes?.connector ?? el.prefixes?.direction;
  return raw === "input" || raw === "output" ? raw : undefined;
}

/** Own components plus those reached through `extends`, ancestors last. */
function* walkComponents(mi: ModelInstance): Iterable<ComponentElement> {
  for (const el of mi.elements ?? []) {
    if (el.$kind === "component") yield el;
    else if (typeof el.baseClass === "object")
      yield* walkComponents(el.baseClass);
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
