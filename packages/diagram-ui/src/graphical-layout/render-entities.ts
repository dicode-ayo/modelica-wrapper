import { html, nothing, type TemplateResult } from "lit";
import { guard } from "lit/directives/guard.js";
import { repeat } from "lit/directives/repeat.js";
import type {
  ComponentInstance,
  ConnectionEndpoint,
  ConnectionLayout,
  ConnectorInstance,
  DiagramLayout,
  IconLayer,
  Shape,
} from "@dicode/omc-client";
import { classNameOf } from "@dicode/omc-client/layout";
import { hasDrawnShapes } from "@dicode/omc-client/shapes";
import { colorToCss } from "@dicode/diagram-svg";

import { withNoIconFallback } from "../icon-provider/no-icon.js";
import { buildSubstitutions } from "../label/build-substitutions.js";
import {
  resolveConnectionWaypoints,
  type EndShift,
} from "../interaction/connection-route.js";
import {
  formatComponentKey,
  formatConnectorKey,
  formatShapeKey,
} from "../interaction/entity-keys.js";
import type { NestedDiagramSource } from "../nesting/nested-diagram-source.js";
import { nestedPortShift, type NestingViews } from "../nesting/nested-ports.js";
import { renderShape } from "../primitives/render-shape.js";

/**
 * Puts host shapes between the grid (`zIndex` -1) and components (0) as
 * `zForOrder(i) - bias`. Holds 500 shapes at `SHAPE_Z_STEP` 0.001; more
 * would paint over components. Visual and hit geometry share it, so a
 * component wins a pick over a shape beneath it.
 */
export const HOST_SHAPE_Z_BIAS = 0.5;

export interface LayoutContentOptions {
  selectedKeys: Set<string>;
  readonly: boolean;
  /** Own-layer host shapes as selectable entities; off draws plain geometry. */
  editableShapes: boolean;
  lineThicknessScale: number | undefined;
  /** `null` keeps every component an icon. */
  nestedSource: NestedDiagramSource | null;
}

/**
 * Everything a layout draws, for the host scene and a nested box alike.
 * `layout.labels` is skipped: the host's `Text` shapes already draw it.
 * `nesting` holds the open boxes, whose wires end on the ports they draw.
 */
export function renderLayoutContent(
  layout: DiagramLayout,
  opts: LayoutContentOptions,
  nesting: NestingViews,
): TemplateResult {
  // `nesting` changes on every zoom step through a fade; only wires read it.
  const entities = guard([layout, ...Object.values(opts)], () => [
    renderHostShapes(layout, opts),
    repeat(visibleComponents(layout), componentRepeatKey, ([id, comp]) =>
      renderComponent(id, comp, layout, opts),
    ),
    repeat(
      Object.entries(layout.connectors),
      ([id]) => id,
      ([id, conn]) => renderStandaloneConnector(id, conn, layout, opts),
    ),
  ]);
  const shift: EndShift = (ep) => nestedPortShift(layout, ep, nesting);
  const viewAt = (ep: ConnectionEndpoint) =>
    ep.component === undefined ? undefined : nesting.get(ep.component);
  return html`
    ${entities}
    ${repeat(
      layout.connections,
      (_, idx) => `conn:${idx}`,
      (conn, idx) =>
        guard(
          [conn, layout, opts.selectedKeys, viewAt(conn.lhs), viewAt(conn.rhs)],
          () => renderConnection(conn, idx, layout, opts.selectedKeys, shift),
        ),
    )}
  `;
}

/** `ownIndex` is the `shape:` key index in the host's own layer; `null` if inherited. */
interface HostShapeSlot {
  shape: Shape;
  zOrder: number;
  ownIndex: number | null;
}

/** Layers arrive ancestor-first, so the running index is paint order. */
function hostShapeSlots(layout: DiagramLayout): HostShapeSlot[] {
  let zOrder = 0;
  return activeLayers(layout).flatMap((layer) => {
    const own = layer.from === layout.className;
    return layer.shapes.map((shape, index) => ({
      shape,
      zOrder: zOrder++,
      ownIndex: own ? index : null,
    }));
  });
}

function renderHostShapes(
  layout: DiagramLayout,
  opts: LayoutContentOptions,
): TemplateResult[] {
  return hostShapeSlots(layout).map((s) =>
    s.ownIndex === null || !opts.editableShapes
      ? renderShape(s.shape, s.zOrder, HOST_SHAPE_Z_BIAS)
      : renderShape(s.shape, s.zOrder, HOST_SHAPE_Z_BIAS, {
          index: s.ownIndex,
          selected: opts.selectedKeys.has(
            formatShapeKey(s.shape.kind, s.ownIndex),
          ),
          // Selecting to copy isn't an edit: read-only keeps the entity, not the handles.
          editHandles: !opts.readonly,
        }),
  );
}

function activeLayers(layout: DiagramLayout): IconLayer[] {
  return layout.kind === "icon" ? layout.iconLayers : layout.diagramLayers;
}

/** A hidden component gets no element, as in OMEdit; its connections still anchor from the layout. */
function visibleComponents(
  layout: DiagramLayout,
): [string, ComponentInstance][] {
  return Object.entries(layout.components).filter(
    ([, comp]) => comp.placement.visible !== false,
  );
}

/** Keyed by class too, so "Change class" remounts rather than overlaying the old icon. */
function componentRepeatKey([id, comp]: [string, ComponentInstance]): string {
  return `${id}\u0000${comp.classRef}`;
}

function renderConnection(
  conn: ConnectionLayout,
  idx: number,
  layout: DiagramLayout,
  selectedKeys: Set<string>,
  shift: EndShift,
): TemplateResult {
  return html`<om-connection
    .nodeId=${String(idx)}
    .path=${resolveConnectionWaypoints(layout, conn, shift)}
    .smooth=${conn.smooth}
    .stroke=${conn.color ? colorToCss(conn.color) : undefined}
    .selectedKeys=${selectedKeys}
  ></om-connection>`;
}

function renderComponent(
  id: string,
  comp: ComponentInstance,
  layout: DiagramLayout,
  opts: LayoutContentOptions,
): TemplateResult {
  const cls = layout.classes[comp.classRef];
  const substitutions = buildSubstitutions(
    comp,
    cls,
    layout.resolvedParameters,
  );
  return html`<om-component
    .nodeId=${id}
    .nestedClass=${classNameOf(layout, comp.classRef)}
    .nestedSource=${comp.openable === true ? opts.nestedSource : null}
    .placement=${comp.placement}
    .layers=${withNoIconFallback(cls?.iconLayers ?? [])}
    .coordinateSystem=${cls?.coordinateSystem ?? undefined}
    .lineThicknessScale=${opts.lineThicknessScale}
    .substitutions=${substitutions}
    ?selected=${opts.selectedKeys.has(formatComponentKey(id))}
    ?readonly=${opts.readonly}
  >
    ${
      cls
        ? Object.entries(cls.connectors)
            // Ports whose `condition` is false for this instance only.
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

function renderStandaloneConnector(
  id: string,
  conn: ConnectorInstance,
  layout: DiagramLayout,
  opts: LayoutContentOptions,
): TemplateResult {
  const cls = layout.classes[conn.classRef];
  // A diagram view prefers the connector's diagram layer (MLS §18.2), with
  // that layer's own extent; component ports stay on the icon layer.
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
    ?selected=${opts.selectedKeys.has(formatConnectorKey(null, id))}
    ?readonly=${opts.readonly}
  ></om-connector>`;
}
