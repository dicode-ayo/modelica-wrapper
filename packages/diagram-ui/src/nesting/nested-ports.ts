import type { ConnectionEndpoint, DiagramLayout } from "@dicode/omc-client";

import {
  applyPlacement,
  coordSystemSize,
  placementCentre,
} from "../base/placement-math.js";
import { letterbox } from "./nesting-math.js";

/** What an open box draws: its class's own diagram, faded in by `progress`. */
export interface NestingView {
  readonly layout: DiagramLayout;
  readonly progress: number;
}

/** Open boxes by component name. */
export type NestingViews = ReadonlyMap<string, NestingView>;

/**
 * Parent-diagram offset from where a component's icon puts `ep`'s port to
 * where its open box draws that port, scaled by the box's progress. `null`
 * when nothing moves: the component is closed, the two layers agree, or the
 * class's own diagram does not draw the port.
 */
export function nestedPortShift(
  layout: DiagramLayout,
  ep: ConnectionEndpoint,
  views: NestingViews,
): { x: number; y: number } | null {
  if (ep.component === undefined) return null;
  const view = views.get(ep.component);
  const comp = layout.components[ep.component];
  if (!view || view.progress <= 0 || !comp) return null;
  if (view.layout.className !== comp.classRef) return null;
  const cls = layout.classes[comp.classRef];
  const iconPort = cls?.connectors[ep.port];
  const ownPort = view.layout.connectors[ep.port];
  if (!cls || !iconPort || !ownPort) return null;

  const placed = applyPlacement(comp.placement, cls.coordinateSystem);
  const fit = letterbox(
    coordSystemSize(view.layout.coordinateSystem),
    coordSystemSize(cls.coordinateSystem),
    placed.scale,
  );
  const [ix, iy] = placementCentre(iconPort.placement);
  const [ox, oy] = placementCentre(ownPort.placement);
  const dx = (fit.x + ox * fit.scaleX - ix) * placed.scale.x * view.progress;
  const dy = (fit.y + oy * fit.scaleY - iy) * placed.scale.y * view.progress;
  if (dx === 0 && dy === 0) return null;
  const cos = Math.cos(placed.rotationZ);
  const sin = Math.sin(placed.rotationZ);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/**
 * Fired by `<om-component>` when what its box draws changes. Bubbles but is
 * not composed, so it reaches only the layout that drew the component.
 */
export const NESTING_CHANGE = "om-nesting-change";

export interface NestingChangeDetail {
  nodeId: string;
  /** `null` once the box draws the icon alone. */
  view: NestingView | null;
}
