import { customElement, property } from "lit/decorators.js";
import { ContextProvider } from "@lit/context";
import type { TextSubstitutions } from "@modelica-wrapper/diagram-svg";

import { OmShapeElement } from "../base/shape-element.js";
import { substitutionsContext } from "../label/substitutions-context.js";

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

  /**
   * Resolved values for `%name` / `%class` / `%<paramName>` text
   * substitution inside the component's icon. Built by the host
   * (`<om-graphical-layout>`) from the component's name, classRef,
   * the class's parameter defaults, and per-instance modifier
   * overrides — provided here as a single Lit context value for any
   * `<om-text>` / `<om-label>` descendant to consume.
   *
   * `null` (the default) leaves text templates un-substituted.
   */
  @property({ attribute: false })
  substitutions: TextSubstitutions | null = null;

  private readonly substitutionsProvider = new ContextProvider(this, {
    context: substitutionsContext,
    initialValue: null as TextSubstitutions | null,
  });

  protected override babylonNodeName(): string {
    return this.nodeId ? `om-component:${this.nodeId}` : "om-component";
  }

  override updated(changed: Map<string, unknown>): void {
    super.updated(changed);
    if (changed.has("substitutions")) {
      this.substitutionsProvider.setValue(this.substitutions);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-component": OmComponent;
  }
}
