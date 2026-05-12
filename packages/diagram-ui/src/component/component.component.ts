import { customElement, property } from "lit/decorators.js";

import { OmShapeElement } from "../base/shape-element.js";

/**
 * `<om-component>` — renders a Modelica `ComponentInstance` as a
 * textured plane in the scene. Inherits the full Lit→Babylon bridge
 * from `OmShapeElement`:
 *
 *   - placement → TransformNode position/rotation/scale
 *   - layers + coordinateSystem → icon texture via icon-provider
 *   - children (`<om-connector>`, `<om-label>`) attach to the component's
 *     `TransformNode` and therefore live in the component class's icon
 *     coord system (e.g. [-100, 100]²)
 *
 * Typical usage:
 *
 *     <om-component
 *       nodeId="R1"
 *       .placement=${componentInstance.placement}
 *       .layers=${layout.classes[componentInstance.classRef].iconLayers}
 *       .coordinateSystem=${layout.classes[componentInstance.classRef].coordinateSystem}>
 *       <om-connector nodeId="p" ...></om-connector>
 *       <om-connector nodeId="n" ...></om-connector>
 *     </om-component>
 */
@customElement("om-component")
export class OmComponent extends OmShapeElement {
  /** Stable identifier — used by the interaction layer (E1) for selection. */
  @property() nodeId = "";

  protected override babylonNodeName(): string {
    return this.nodeId ? `om-component:${this.nodeId}` : "om-component";
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-component": OmComponent;
  }
}
