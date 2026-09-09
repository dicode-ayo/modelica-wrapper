import { Container, Graphics } from "pixi.js";
import type { Color } from "@dicode/omc-client";
import { arrowheadOutline, type Arrowhead } from "@dicode/diagram-svg";

import { packColor, type OwnedResource } from "./shape-utils.js";

/**
 * Build one resolved arrowhead as a `Graphics` child of `parent`. `strokeWidth`
 * (see {@link resolveStrokeWidth}) is the outline width for the open kinds; a
 * closed head is filled and has no outline to widen.
 */
export function buildArrowhead(
  parent: Container,
  head: Arrowhead,
  color: Color,
  z: number,
  baseName: string,
  strokeWidth: number,
): OwnedResource {
  const { vertices, closed } = arrowheadOutline(head);
  const [first, ...rest] = vertices;
  const packed = packColor(color);

  const g = new Graphics({ label: baseName });
  g.eventMode = "none";
  g.zIndex = z;

  g.moveTo(first[0], first[1]);
  for (const [x, y] of rest) {
    g.lineTo(x, y);
  }
  if (closed) {
    g.closePath();
    g.fill(packed);
  } else {
    g.stroke({ width: strokeWidth, color: packed, cap: "butt", join: "miter" });
  }

  parent.addChild(g);
  return { dispose: () => g.destroy() };
}
