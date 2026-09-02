import type {
  ComponentElement,
  ModelInstance,
  ParameterField,
  ParameterModel,
  UnitTable,
} from "@dicode/omc-client";

import {
  buildClassParameterForm,
  buildComponentParameterForm,
  findSubComponent,
  type ComponentParameterFormState,
  type ParameterFormState,
} from "../src/diagram/parameter-edits.js";

export function requireClassParameterForm(
  instance: ModelInstance,
): ParameterFormState {
  const form = buildClassParameterForm(instance);
  if (form === undefined) throw new Error("expected a parameter form");
  return form;
}

export function requireComponentParameterForm(
  component: ComponentElement,
  unitTable?: UnitTable,
): ComponentParameterFormState {
  const form = buildComponentParameterForm(component, unitTable);
  if (form === undefined) throw new Error("expected a parameter form");
  return form;
}

export function fieldOf(model: ParameterModel, name: string): ParameterField {
  const field = model.fields.find((f) => f.name === name);
  if (field === undefined) throw new Error(`expected field '${name}'`);
  return field;
}

export function requireSubComponent(
  instance: ModelInstance,
  name: string,
): ComponentElement {
  const component = findSubComponent(instance, name);
  if (component === undefined) {
    throw new Error(`expected sub-component '${name}'`);
  }
  return component;
}
