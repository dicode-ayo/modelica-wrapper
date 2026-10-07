import type { ConnectionEndpoint, DiagramLayout } from "@dicode/omc-client";

import {
  applyPlacement,
  coordSystemSize,
  iconToParent,
  placementCentre,
} from "../base/placement-math.js";
import { endpointCentreFromLayout } from "../interaction/connection-route.js";
import type { DiagramPoint } from "../scene/view-math.js";
import { fitPoint, nestedFit } from "./nesting-math.js";

/** Below this the layers agree; the letterbox scale leaves float noise. */
const AGREE_EPSILON = 1e-9;

/** What an open box draws: its class's own diagram, faded in by `progress`. */
export interface NestingView {
  readonly layout: DiagramLayout;
  readonly progress: number;
}

/** Open boxes by component name. */
export type NestingViews = ReadonlyMap<string, NestingView>;

/**
 * `om-nesting-change`, fired by `<om-component>` when what its box draws
 * changes. Not composed, so only the layout that drew the component hears it.
 */
export interface NestingChangeDetail {
  nodeId: string;
  /** `null` once the box draws the icon alone. */
  view: NestingView | null;
}

/**
 * Offset from where `ep`'s icon port sits to where its open box draws it,
 * scaled by progress. `null` when nothing moves.
 */
export function nestedPortShift(
  layout: DiagramLayout,
  ep: ConnectionEndpoint,
  views: NestingViews,
): DiagramPoint | null {
  if (ep.component === undefined) return null;
  const view = views.get(ep.component);
  const comp = layout.components[ep.component];
  if (!view || view.progress <= 0 || !comp) return null;
  if (view.layout.className !== comp.classRef) return null;
  const cls = layout.classes[comp.classRef];
  const ownPort = view.layout.connectors[ep.port];
  const icon = endpointCentreFromLayout(layout, ep);
  if (!cls || !ownPort || !icon) return null;

  const fit = nestedFit(
    view.layout.coordinateSystem,
    coordSystemSize(cls.coordinateSystem),
    applyPlacement(comp.placement, cls.coordinateSystem).scale,
  );
  const drawn = iconToParent(
    comp.placement,
    cls.coordinateSystem,
    fitPoint(fit, placementCentre(ownPort.placement)),
  );
  const dx = drawn.x - icon.x;
  const dy = drawn.y - icon.y;
  if (Math.hypot(dx, dy) < AGREE_EPSILON) return null;
  return { x: dx * view.progress, y: dy * view.progress };
}
