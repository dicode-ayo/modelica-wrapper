import type {
  ComponentInstance,
  ConnectorInstance,
  DiagramLayout,
} from "@dicode/omc-client";

/**
 * The instances the layout's view puts on the canvas, for drawing, selecting
 * and fitting alike. An icon (MLS §18.6) shows the class's own graphics and
 * its public connectors only. Sub-components and protected connectors stay in
 * the layout, where edit paths still need them (a new instance's name must
 * not collide with one), but the icon neither draws nor selects them.
 */
export function viewComponents(
  layout: DiagramLayout,
): [string, ComponentInstance][] {
  return layout.kind === "icon" ? [] : Object.entries(layout.components);
}

export function viewConnectors(
  layout: DiagramLayout,
): [string, ConnectorInstance][] {
  const all = Object.entries(layout.connectors);
  return layout.kind === "icon"
    ? all.filter(([, c]) => c.prefixes?.public !== false)
    : all;
}
