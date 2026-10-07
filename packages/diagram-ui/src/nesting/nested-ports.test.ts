import { describe, expect, it } from "vitest";
import type {
  ClassDef,
  ComponentInstance,
  DiagramLayout,
  Placement,
} from "@dicode/omc-client";

import { emptyLayout } from "../../test/harness/layout-fixtures.js";
import { nestedPortShift, type NestingView } from "./nested-ports.js";

function portAt(x: number, y: number): Placement {
  return {
    extent: [
      [x - 10, y - 10],
      [x + 10, y + 10],
    ],
  };
}

function pidClass(overrides: Partial<ClassDef> = {}): ClassDef {
  return {
    name: "P.LimPID",
    restriction: "block",
    iconLayers: [],
    connectors: {
      u: {
        name: "u",
        typeName: "P.RealInput",
        placement: portAt(-100, 0),
        iconLayers: [],
        from: "P.LimPID",
      },
    },
    parameters: {},
    ...overrides,
  };
}

function host(placement: Placement, cls: ClassDef = pidClass()): DiagramLayout {
  const pid: ComponentInstance = {
    name: "pid",
    classRef: "P.LimPID",
    placement,
    openable: true,
  };
  return {
    ...emptyLayout(),
    classes: { "P.LimPID": cls },
    components: { pid },
  };
}

/** LimPID's own diagram, drawing `u` at `(x, y)`. */
function view(x: number, y: number, progress = 1): NestingView {
  return {
    progress,
    layout: {
      ...emptyLayout(),
      className: "P.LimPID",
      connectors: {
        u: { name: "u", classRef: "P.RealInput", placement: portAt(x, y) },
      },
    },
  };
}

const BOX: Placement = {
  extent: [
    [-10, -10],
    [10, 10],
  ],
};

const PID_U = { component: "pid", port: "u" };

describe("nestedPortShift", () => {
  it("moves a port to where the open box draws it, in parent units", () => {
    const shift = nestedPortShift(
      host(BOX),
      PID_U,
      new Map([["pid", view(-100, 40)]]),
    );
    expect(shift?.x).toBeCloseTo(0);
    expect(shift?.y).toBeCloseTo(4);
  });

  it("covers the same fraction of the way as the box is faded in", () => {
    const shift = nestedPortShift(
      host(BOX),
      PID_U,
      new Map([["pid", view(-100, 40, 0.5)]]),
    );
    expect(shift?.y).toBeCloseTo(2);
  });

  it("leaves a port alone where the layers agree up to float noise", () => {
    const third: Placement = {
      extent: [
        [-10, -10],
        [10 / 3, 10 / 3],
      ],
    };
    expect(
      nestedPortShift(host(third), PID_U, new Map([["pid", view(-100, 0)]])),
    ).toBeNull();
  });

  it("leaves a port alone while its component is not open", () => {
    expect(
      nestedPortShift(host(BOX), PID_U, new Map([["pid", view(-100, 40, 0)]])),
    ).toBeNull();
    expect(nestedPortShift(host(BOX), PID_U, new Map())).toBeNull();
  });

  it("ignores an open view drawing a class other than the component's", () => {
    const stale = view(-100, 40);
    stale.layout.className = "P.Other";
    expect(
      nestedPortShift(host(BOX), PID_U, new Map([["pid", stale]])),
    ).toBeNull();
  });

  it("leaves a port alone where the class's own diagram does not draw it", () => {
    const bare: NestingView = {
      progress: 1,
      layout: { ...emptyLayout(), className: "P.LimPID" },
    };
    expect(
      nestedPortShift(host(BOX), PID_U, new Map([["pid", bare]])),
    ).toBeNull();
  });

  it("turns the shift with a rotated placement", () => {
    const shift = nestedPortShift(
      host({ ...BOX, rotation: 90 }),
      PID_U,
      new Map([["pid", view(-100, 40)]]),
    );
    expect(shift?.x).toBeCloseTo(-4);
    expect(shift?.y).toBeCloseTo(0);
  });

  it("follows the unmirrored nested port across a flipped placement", () => {
    const flipped: Placement = {
      extent: [
        [10, -10],
        [-10, 10],
      ],
    };
    // The flipped icon draws `u` on the right; the unmirrored box, on the left.
    const shift = nestedPortShift(
      host(flipped),
      PID_U,
      new Map([["pid", view(-100, 40)]]),
    );
    expect(shift?.x).toBeCloseTo(-20);
    expect(shift?.y).toBeCloseTo(4);
  });

  it("pulls a port inward by the letterbox of a wide icon", () => {
    const wide = pidClass({
      coordinateSystem: {
        extent: [
          [-100, -50],
          [100, 50],
        ],
      },
    });
    const placement: Placement = {
      extent: [
        [-10, -5],
        [10, 5],
      ],
    };
    const shift = nestedPortShift(
      host(placement, wide),
      PID_U,
      new Map([["pid", view(-100, 40)]]),
    );
    expect(shift?.x).toBeCloseTo(5);
    expect(shift?.y).toBeCloseTo(2);
  });
});
