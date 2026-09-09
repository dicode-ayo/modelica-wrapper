import { Container, Graphics } from "pixi.js";
import type { Color } from "@dicode/omc-client";
import { arrowheadVertices, type Arrowhead } from "@dicode/diagram-svg";

import { packColor, type OwnedResource } from "./shape-utils.js";

/**
 * Build one resolved arrowhead as a `Graphics` child of `parent`. `strokeWidth`
 * (see {@link resolveStrokeWidth}) is the outline width for `"Open"` and
 * `"Half"`; `"Filled"` has no outline and ignores it.
 */
export function buildArrowhead(
  parent: Container,
  head: Arrowhead,
  color: Color,
  z: number,
  baseName: string,
  strokeWidth: number,
): OwnedResource {
  const v = arrowheadVertices(head);
  const colour = packColor(color);

  const g = new Graphics({ label: baseName });
  g.eventMode = "none";
  g.zIndex = z;

  if (head.kind === "Filled") {
    g.poly([v.tip[0], v.tip[1], v.left[0], v.left[1], v.right[0], v.right[1]]);
    g.fill(colour);
  } else {
    if (head.kind === "Open") {
      g.moveTo(v.left[0], v.left[1])
        .lineTo(v.tip[0], v.tip[1])
        .lineTo(v.right[0], v.right[1]);
    } else {
      g.moveTo(v.tip[0], v.tip[1]).lineTo(v.left[0], v.left[1]);
    }
    g.stroke({
      width: strokeWidth,
      color: colour,
      cap: "butt",
      join: "miter",
    });
  }

  parent.addChild(g);
  return { dispose: () => g.destroy() };
}
