import type { DiagramLayout, ParameterDef } from "@dicode/omc-client";

export function paramOf(
  layout: DiagramLayout,
  className: string,
  name: string,
): ParameterDef {
  const cls = layout.classes[className];
  if (cls === undefined) throw new Error(`expected class '${className}'`);
  const param = cls.parameters[name];
  if (param === undefined) throw new Error(`expected parameter '${name}'`);
  return param;
}
