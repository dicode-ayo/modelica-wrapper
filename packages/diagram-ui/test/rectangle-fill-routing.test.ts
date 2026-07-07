/**
 * Headless coverage for `<om-rectangle>`'s fill routing — which fill graphic
 * gets built. A gradient or hatch pattern emits a filled `Graphics`; a `None`
 * pattern emits none (leaving only the outline). happy-dom has no canvas 2D
 * context, so the baked texture can't run — the fill degrades to a flat
 * colour, but the routing decision (fill graphic present or absent) is what
 * these pin. Pixi `Graphics` fills carry no per-vertex UV buffers (the
 * Babylon `getVerticesData(UVKind)` checks have no analogue and are dropped).
 */
import { afterEach, describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import type { RectangleShape } from "@dicode/omc-client";

import { OmRectangle } from "../src/primitives/rectangle.component.js";

class TestRectangle extends OmRectangle {
  buildMeshesAt(parent: Container, z: number): void {
    this.buildMeshes(parent, z);
  }
}

const teardowns: Array<() => void> = [];

function makeScene(): { parent: Container } {
  return { parent: new Container({ label: "test-parent" }) };
}

afterEach(() => {
  for (const t of teardowns.splice(0)) t();
});

const FILL: [number, number, number] = [192, 192, 192];
const LINE: [number, number, number] = [64, 64, 64];
const EXTENT: [[number, number], [number, number]] = [
  [-10, -5],
  [10, 5],
];

function buildRect(parent: Container, shape: RectangleShape) {
  const el = new TestRectangle();
  el.shape = shape;
  el.buildMeshesAt(parent, 0);
  teardowns.push(() => el.disconnectedCallback());
  return el;
}

const FILL_MESH = "om-rectangle.0.fill";

describe("<om-rectangle> fill routing", () => {
  it("builds a fill graphic for a rounded gradient rectangle", () => {
    const { parent } = makeScene();
    buildRect(parent, {
      kind: "rectangle",
      extent: EXTENT,
      fillColor: FILL,
      lineColor: LINE,
      fillPattern: "HorizontalCylinder",
      pattern: "Solid",
      radius: 3,
    });
    expect(parent.getChildByLabel(FILL_MESH, true)).not.toBeNull();
  });

  it("builds a fill graphic for a sharp gradient rectangle", () => {
    const { parent } = makeScene();
    buildRect(parent, {
      kind: "rectangle",
      extent: EXTENT,
      fillColor: FILL,
      lineColor: LINE,
      fillPattern: "HorizontalCylinder",
      pattern: "Solid",
    });
    expect(parent.getChildByLabel(FILL_MESH, true)).not.toBeNull();
  });

  it("builds a fill graphic for a sharp hatch rectangle", () => {
    const { parent } = makeScene();
    buildRect(parent, {
      kind: "rectangle",
      extent: EXTENT,
      fillColor: FILL,
      lineColor: LINE,
      fillPattern: "Forward",
      pattern: "Solid",
    });
    expect(parent.getChildByLabel(FILL_MESH, true)).not.toBeNull();
  });

  it("emits no fill graphic for a None pattern, leaving only the outline", () => {
    const { parent } = makeScene();
    buildRect(parent, {
      kind: "rectangle",
      extent: EXTENT,
      fillColor: FILL,
      lineColor: LINE,
      fillPattern: "None",
      pattern: "Solid",
    });
    expect(parent.getChildByLabel(FILL_MESH, true)).toBeNull();
  });
});
