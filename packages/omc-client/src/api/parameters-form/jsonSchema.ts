/**
 * `ParameterModel` → JSON Schema adapter — the inverse of the form layer's
 * `parameterFieldsFromSchema`.
 *
 * The webview renders `ParameterModel` directly (no JSON Schema in the form /
 * wire path; see `docs/parameter-model-design.md`, Revision 2026-05-21). This
 * adapter is retained ONLY as an exported helper for non-UI consumers — MCP
 * tools that speak JSON Schema, schema-validating callers, and tests that want
 * to assert the model in a standard vocabulary. It is not on the host↔webview
 * path.
 *
 * The Modelica-specific facts that have no JSON-Schema home (Dialog tab/group/
 * enable, the base/display unit, the unit options, the qualified enum type) are
 * carried on `x-modelica-*` extension keys — the same keys the old form adapter
 * read — so the transform round-trips through `parameterFieldsFromSchema`.
 *
 * Pure: no OMC contact, no rendering.
 */

import type { JsonSchema } from "../../help.js";
import type { ParameterField, ParameterModel } from "./types.js";

/**
 * Convert a `ParameterModel` into a JSON Schema object whose top-level
 * properties mirror the model's fields (in order). Every field becomes a
 * `required` property (the form treats class-default-bearing fields as
 * pre-filled, not optional). Modelica metadata rides on `x-modelica-*` keys.
 */
export function parameterModelToJsonSchema(model: ParameterModel): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const field of model.fields) {
    properties[field.name] = fieldToNode(field);
    required.push(field.name);
  }
  return {
    type: "object",
    properties,
    required,
  } as JsonSchema;
}

function fieldToNode(field: ParameterField): JsonSchema {
  const node: Record<string, unknown> = {};

  // Base JSON type + enum.
  switch (field.kind) {
    case "number":
      node.type = "number";
      break;
    case "integer":
      node.type = "integer";
      break;
    case "boolean":
      node.type = "boolean";
      break;
    case "enum":
      node.type = "string";
      if (field.enumChoices && field.enumChoices.length > 0) {
        node.enum = [...field.enumChoices];
      }
      break;
    case "string":
    case "unsupported":
    default:
      node.type = "string";
      break;
  }

  if (field.label !== undefined) node.description = field.label;
  if (field.defaultValue !== undefined && isScalar(field.defaultValue)) {
    node.default = field.defaultValue;
  }

  // Modelica metadata → x-modelica-* extension keys (read back by
  // parameterFieldsFromSchema).
  if (field.dialog.tab !== undefined) node["x-modelica-tab"] = field.dialog.tab;
  if (field.dialog.group !== undefined) {
    node["x-modelica-group"] = field.dialog.group;
  }
  if (field.dialog.enable !== undefined) {
    node["x-modelica-enable"] = field.dialog.enable;
  }
  if (field.enumTypeName !== undefined) {
    node["x-modelica-enum-type"] = field.enumTypeName;
  }
  if (field.unit !== undefined) node["x-modelica-unit"] = field.unit;
  if (field.displayUnit !== undefined) {
    node["x-modelica-display-unit"] = field.displayUnit;
  }
  if (field.unitOptions.length > 0) {
    node["x-modelica-unit-options"] = field.unitOptions.map((o) => ({
      unit: o.unit,
      scaleFactor: o.scaleFactor,
      offset: o.offset,
    }));
  }

  return node as JsonSchema;
}

function isScalar(v: unknown): v is string | number | boolean {
  return (
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}
