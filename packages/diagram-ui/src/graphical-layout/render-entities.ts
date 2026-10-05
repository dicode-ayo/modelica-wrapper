import { html, nothing, type TemplateResult } from "lit";
import type {
  ComponentInstance,
  ConnectionLayout,
  ConnectorInstance,
  DiagramLayout,
  IconLayer,
} from "@dicode/omc-client";
import { hasDrawnShapes } from "@dicode/omc-client/shapes";
import { colorToCss } from "@dicode/diagram-svg";

import { withNoIconFallback } from "../icon-provider/no-icon.js";
import { buildSubstitutions } from "../label/build-substitutions.js";
import { resolveConnectionWaypoints } from "../interaction/connection-route.js";
import type { NestedDiagramSource } from "../nesting/nested-diagram-source.js";

/**
 * Paint-order bias for the host class's shapes (own and inherited) so they
 * sit behind every component / connector but in front of the grid. Uses the
 * scene-z convention where positive is further from the viewer — both
 * primitive paths negate it into `zIndex`, then add `zForOrder(zOrder)` so
 * annotation-array order paints first-at-the-bottom within the band:
 *
 *   grid         zIndex = -1
 *   host shapes  zIndex = zForOrder(i) - HOST_SHAPE_Z_BIAS ← here
 *   components   zIndex =  0
 *
 * The band's capacity is where `zForOrder(i)` reaches the bias (500 shapes
 * at `SHAPE_Z_STEP` 0.001); a shape past that would paint over components.
 *
 * Shared by a shape's visual and its hit geometry so picks land in the same
 * band and a component always wins a pick over a shape beneath it.
 */
export const HOST_SHAPE_Z_BIAS = 0.5;

export interface EntityRenderOptions {
  selected: boolean;
  readonly: boolean;
  lineThicknessScale: number | undefined;
}

export interface ComponentRenderOptions extends EntityRenderOptions {
  /** Fetches the class diagram an openable component shows on zoom. `null`
   *  keeps every component an icon at every zoom level. */
  nestedSource: NestedDiagramSource | null;
}

/** The layer set the layout's view shows: `iconLayers` or `diagramLayers`. */
export function activeLayers(layout: DiagramLayout): IconLayer[] {
  return layout.kind === "icon" ? layout.iconLayers : layout.diagramLayers;
}

/**
 * The components a scene draws. Mirrors `renderShape`'s `visible === false`
 * skip (render-shape.ts): OMEdit doesn't draw a hidden component either, so
 * it gets no `<om-component>` at all — unpickable and unselectable, same as
 * a hidden shape. `Placement.visible` is already resolved to a literal by
 * the producer (`placementFor`), so there's no DynamicSelect case to peel
 * here. Its connections still route from `layout.components` directly
 * (`endpointCentreFromLayout`), not from this element, so they keep
 * anchoring correctly with nothing left to crash into.
 */
export function visibleComponents(
  layout: DiagramLayout,
): [string, ComponentInstance][] {
  return Object.entries(layout.components).filter(
    ([, comp]) => comp.placement.visible !== false,
  );
}

/**
 * `repeat` key for a component. Class is part of the key so a "Change class"
 * swap remounts the node: a reused element keeps the previous class's icon
 * children, leaving old and new visuals overlaid. NUL can't appear in a
 * component name or qualified class name, so the split is unambiguous.
 */
export function componentRepeatKey([id, comp]: [
  string,
  ComponentInstance,
]): string {
  return `${id}\u0000${comp.classRef}`;
}

/** One `<om-connection>`, routed through the layout. */
export function renderConnection(
  conn: ConnectionLayout,
  idx: number,
  layout: DiagramLayout,
  selectedKeys: Set<string>,
): TemplateResult {
  return html`<om-connection
    .nodeId=${String(idx)}
    .path=${resolveConnectionWaypoints(layout, conn)}
    .smooth=${conn.smooth}
    .stroke=${conn.color ? colorToCss(conn.color) : undefined}
    .selectedKeys=${selectedKeys}
  ></om-connection>`;
}

/** One `<om-component>` with its class's (per-instance visible) ports. */
export function renderComponent(
  id: string,
  comp: ComponentInstance,
  layout: DiagramLayout,
  opts: ComponentRenderOptions,
): TemplateResult {
  const cls = layout.classes[comp.classRef];
  const substitutions = buildSubstitutions(
    comp,
    cls,
    layout.resolvedParameters,
  );
  return html`<om-component
    .nodeId=${id}
    .classRef=${comp.classRef}
    .nestedSource=${comp.openable === true ? opts.nestedSource : null}
    .placement=${comp.placement}
    .layers=${withNoIconFallback(cls?.iconLayers ?? [])}
    .coordinateSystem=${cls?.coordinateSystem ?? undefined}
    .lineThicknessScale=${opts.lineThicknessScale}
    .substitutions=${substitutions}
    ?selected=${opts.selected}
    ?readonly=${opts.readonly}
  >
    ${
      cls
        ? Object.entries(cls.connectors)
            // Per-instance gating: a port that's listed in
            // `comp.hiddenPorts` was elided by the producer because
            // its `condition` predicate evaluates to false for THIS
            // instance (e.g. `Torque(useSupport=false)` hides
            // `support`). The class def itself still lists the port
            // — sibling instances of the same type may have it
            // visible.
            .filter(([pid]) => !comp.hiddenPorts?.includes(pid))
            .map(
              ([pid, port]) =>
                html`<om-connector
                  .nodeId=${pid}
                  .placement=${port.placement}
                  .layers=${withNoIconFallback(port.iconLayers)}
                  .coordinateSystem=${cls.coordinateSystem ?? undefined}
                  .lineThicknessScale=${opts.lineThicknessScale}
                  ?readonly=${opts.readonly}
                ></om-connector>`,
            )
        : nothing
    }
  </om-component>`;
}

/** One host-level `<om-connector>`. */
export function renderStandaloneConnector(
  id: string,
  conn: ConnectorInstance,
  layout: DiagramLayout,
  opts: EntityRenderOptions,
): TemplateResult {
  const cls = layout.classes[conn.classRef];
  // A diagram view shows the connector class's own diagram layer when it
  // draws one (MLS §18.2 — e.g. RealInput's smaller triangle + name),
  // falling back to its icon. Nested ports above stay on the icon layer:
  // that is what an enclosing diagram shows for a component's connectors.
  //
  // The two annotations can declare different extents, so the layers and
  // the system they are measured in have to be chosen together.
  const diagramLayers = cls?.diagramLayers ?? [];
  const showsDiagram =
    layout.kind === "diagram" && hasDrawnShapes(diagramLayers);
  const layers = showsDiagram ? diagramLayers : (cls?.iconLayers ?? []);
  const coordinateSystem = showsDiagram
    ? (cls?.diagramCoordinateSystem ?? cls?.coordinateSystem)
    : cls?.coordinateSystem;
  return html`<om-connector
    .nodeId=${id}
    .placement=${conn.placement}
    .layers=${withNoIconFallback(layers)}
    .coordinateSystem=${coordinateSystem ?? undefined}
    .lineThicknessScale=${opts.lineThicknessScale}
    ?selected=${opts.selected}
    ?readonly=${opts.readonly}
  ></om-connector>`;
}
