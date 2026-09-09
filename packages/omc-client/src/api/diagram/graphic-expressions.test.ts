/**
 * Graphic annotation fields OMC ships as unevaluated expressions (issue #605).
 *
 * `getModelInstance` reduces a component's parameters against the use-site
 * modifiers but leaves the `visible` / color / geometry slots of a graphic as
 * an expression referencing them. A field referencing a use-site parameter
 * must arrive as the value OMC resolved for that instance, not as the §18.6
 * default.
 *
 * `PartialElementaryOneFlangeAndSupport2` carries five `Line(visible = not
 * useSupport, …)` — the ground symbol shown when the component is implicitly
 * grounded. A `Torque(useSupport = true)` has a real support connector and
 * must not also be drawn sitting on ground.
 */

import { describe, expect, it } from "vitest";

import type { Shape } from "../../_shared/diagramLayout.js";
import type {
  ElementNode,
  Expression,
  ModelInstance,
  RecordValue,
} from "../../_shared/modelInstance.js";
import { produceDiagramLayout } from "./producer.js";

const SOLID_LINE: Expression = {
  $kind: "enum",
  name: "LinePattern.Solid",
  index: 1,
};
const NO_ARROW: Expression = { $kind: "enum", name: "Arrow.None", index: 1 };
const NO_SMOOTH: Expression = { $kind: "enum", name: "Smooth.None", index: 1 };

/** `Line(visible = <expr>, color = <expr>, …)` with every slot filled. */
function lineShape(
  visible: Expression,
  color: Expression = [0, 0, 0],
): RecordValue {
  return {
    $kind: "record",
    name: "Line",
    elements: [
      visible,
      [0, 0],
      0,
      [
        [-30, -10],
        [30, -10],
      ],
      color,
      SOLID_LINE,
      0.25,
      [NO_ARROW, NO_ARROW],
      3,
      NO_SMOOTH,
    ],
  };
}

/** OMC qualifies the cref by the instance path from the opened class. */
function notUseSupport(instance: string): Expression {
  return {
    $kind: "unary_op",
    op: "not",
    exp: { $kind: "cref", parts: [{ name: instance }, { name: "useSupport" }] },
  };
}

/** `if <instance>.useSupport then {255, 0, 0} else {0, 0, 255}`. */
function colorByUseSupport(instance: string): Expression {
  return {
    $kind: "if",
    condition: {
      $kind: "cref",
      parts: [{ name: instance }, { name: "useSupport" }],
    },
    true: [255, 0, 0],
    false: [0, 0, 255],
  };
}

/** One `Torque <name>(useSupport = …)`, carrying OMC's reduced value. */
function torque(name: string, useSupport: boolean): ElementNode {
  return {
    $kind: "component",
    name,
    annotation: {
      Placement: {
        transformation: {
          extent: [
            [-10, -10],
            [10, 10],
          ],
        },
      },
    },
    type: {
      name: "Torque",
      restriction: "model",
      elements: [
        {
          $kind: "extends",
          baseClass: {
            name: "PartialElementaryOneFlangeAndSupport2",
            restriction: "model",
            annotation: {
              Icon: {
                graphics: [
                  lineShape(notUseSupport(name)),
                  lineShape(true, colorByUseSupport(name)),
                ],
              },
            },
            elements: [
              {
                $kind: "component",
                name: "support",
                // OMC reduces an `if`-condition itself, so this shape only
                // arrives when it couldn't — the decoder must not then fall
                // back to "port visible" and contradict the graphics.
                condition: {
                  binding: {
                    $kind: "cref",
                    parts: [{ name }, { name: "useSupport" }],
                  },
                },
                type: {
                  name: "Support",
                  restriction: "connector",
                  annotation: {
                    Placement: {
                      iconTransformation: {
                        extent: [
                          [-10, -110],
                          [10, -90],
                        ],
                      },
                    },
                  },
                },
              },
              {
                $kind: "component",
                name: "useSupport",
                type: "Boolean",
                value: {
                  binding: { $kind: "cref", parts: [{ name: "useIt" }] },
                  value: useSupport,
                },
              },
            ],
          },
        },
      ],
    },
  };
}

function host(...components: ElementNode[]): ModelInstance {
  return { name: "Cond2", restriction: "model", elements: components };
}

function shapesForInstance(mi: ModelInstance, instance: string): Shape[] {
  const layout = produceDiagramLayout(mi, "diagram");
  const comp = layout.components[instance];
  if (comp === undefined) throw new Error(`no instance '${instance}'`);
  const cls = layout.classes[comp.classRef];
  if (cls === undefined) throw new Error(`no ClassDef '${comp.classRef}'`);
  return cls.iconLayers.flatMap((l) => l.shapes);
}

function shapesOf(mi: ModelInstance, className: string): Shape[] {
  const layout = produceDiagramLayout(mi, "diagram");
  const cls = layout.classes[className];
  if (cls === undefined) throw new Error(`no ClassDef for '${className}'`);
  return cls.iconLayers.flatMap((l) => l.shapes);
}

describe("expression-valued graphic fields", () => {
  it("hides the ground symbol once a support connector is enabled", () => {
    const shapes = shapesOf(host(torque("t", true)), "Torque");
    expect(shapes[0]?.visible).toBe(false);
  });

  it("keeps the ground symbol drawn when the component is grounded", () => {
    const shapes = shapesOf(host(torque("t", false)), "Torque");
    expect(shapes[0]?.visible).toBeUndefined();
  });

  it("gives two copies of one class the icon each resolved to", () => {
    const mi = host(torque("on", true), torque("off", false));
    expect(shapesForInstance(mi, "on")[0]?.visible).toBe(false);
    expect(shapesForInstance(mi, "off")[0]?.visible).toBeUndefined();
  });

  it("reduces fields other than visible against the same scope", () => {
    const on = shapesOf(host(torque("t", true)), "Torque")[1];
    const off = shapesOf(host(torque("t", false)), "Torque")[1];
    expect(on?.kind === "line" ? on.color : undefined).toEqual([255, 0, 0]);
    expect(off?.kind === "line" ? off.color : undefined).toEqual([0, 0, 255]);
  });

  it("gates a port on an unreduced condition instead of defaulting it on", () => {
    const layout = produceDiagramLayout(
      host(torque("on", true), torque("off", false)),
      "diagram",
    );
    expect(layout.components["on"]?.hiddenPorts).toBeUndefined();
    expect(layout.components["off"]?.hiddenPorts).toEqual(["support"]);
  });

  it("shares one catalog entry between copies that resolve alike", () => {
    const layout = produceDiagramLayout(
      host(torque("a", true), torque("b", true)),
      "diagram",
    );
    expect(layout.components["a"]?.classRef).toBe(
      layout.components["b"]?.classRef,
    );
    expect(
      Object.values(layout.classes).filter((c) => c.name === "Torque"),
    ).toHaveLength(1);
  });

  it("keeps the real class name on a suffixed catalog entry", () => {
    const layout = produceDiagramLayout(
      host(torque("on", true), torque("off", false)),
      "diagram",
    );
    const on = layout.components["on"]?.classRef;
    const off = layout.components["off"]?.classRef;
    expect(on).not.toBe(off);
    expect(layout.classes[on ?? ""]?.name).toBe("Torque");
    expect(layout.classes[off ?? ""]?.name).toBe("Torque");
  });
});
