import type { ConnectionEndpoint, DiagramLayout } from "@dicode/omc-client";

import {
  applyPlacement,
  coordSystemSize,
  iconToParent,
  placementCentre,
} from "../base/placement-math.js";
import { letterbox } from "./nesting-math.js";

/** Parent-diagram units below which the two layers count as agreeing. */
const AGREE_EPSILON = 1e-9;

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
  const [ox, oy] = placementCentre(ownPort.placement);
  const drawn = iconToParent(comp.placement, cls.coordinateSystem, [
    fit.x + ox * fit.scaleX,
    fit.y + oy * fit.scaleY,
  ]);
  const icon = iconToParent(
    comp.placement,
    cls.coordinateSystem,
    placementCentre(iconPort.placement),
  );
  const dx = (drawn.x - icon.x) * view.progress;
  const dy = (drawn.y - icon.y) * view.progress;
  // Float noise from the letterbox scale must not read as a move.
  if (Math.hypot(dx, dy) < AGREE_EPSILON) return null;
  return { x: dx, y: dy };
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
