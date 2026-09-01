import type {
  ComponentElement,
  ModelInstance,
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
  unitTable?: UnitTable,
): ParameterFormState {
  const form = buildClassParameterForm(instance, unitTable);
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
