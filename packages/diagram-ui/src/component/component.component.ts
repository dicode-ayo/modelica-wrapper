import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ContextProvider } from "@lit/context";
import type { TextSubstitutions } from "@dicode/diagram-svg";
import type { DiagramLayout } from "@dicode/omc-client";

import { OmShapeElement } from "../base/shape-element.js";
import "../base/layer-group.component.js";
import { applyPlacement, coordSystemSize } from "../base/placement-math.js";
import { substitutionsContext } from "../label/substitutions-context.js";
import type { NestedDiagramSource } from "../nesting/nested-diagram-source.js";
import { nestingProgress } from "../nesting/nesting-math.js";
import "../nesting/nested-diagram.component.js";
import { renderLayers } from "../primitives/render-shape.js";
import { watchViewState } from "../scene/view-state-store.js";

/**
 * `<om-component>` — renders a Modelica `ComponentInstance` as an icon
 * sprite in the scene. Inherits the full Lit→Pixi bridge from
 * `OmShapeElement`:
 *
 *   - placement → Container position/rotation/scale
 *   - layers + coordinateSystem → icon texture via icon-provider
 *   - children (`<om-connector>`, `<om-label>`) attach to the component's
 *     `Container` and therefore live in the component class's icon
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
 *
 * Given a `nestedSource`, the component opens in place on zoom: once its
 * box is large enough on screen it fetches its class's own diagram and
 * cross-fades from the icon to that diagram as the box grows. Ports stay
 * on the icon's placement either way.
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

  /** Qualified class name — what `nestedSource` is asked for. */
  @property() classRef = "";

  /** Fetches this component's class diagram; `null` keeps it an icon. */
  @property({ attribute: false })
  nestedSource: NestedDiagramSource | null = null;

  /** The fetched class diagram, once it has arrived. */
  @state() private nestedLayout: DiagramLayout | null = null;

  /** Open fraction from the box's on-screen size; see `nestingProgress`. */
  @state() private nestingOpen = 0;

  /** Diagram units per CSS px while the box is open, for its frame. */
  @state() private openWorldPerPixel = 1;

  /** The class whose fetch this element has issued, so it asks once. */
  private requestedClass: string | null = null;

  private readonly viewWatch = watchViewState(this, () => this.syncNesting());

  private readonly substitutionsProvider = new ContextProvider(this, {
    context: substitutionsContext,
    initialValue: null as TextSubstitutions | null,
  });

  protected override entityNodeName(): string {
    return this.nodeId ? `om-component:${this.nodeId}` : "om-component";
  }

  override render(): TemplateResult {
    if (!this.nestedSource) return super.render();
    const open = this.nestedLayout ? this.nestingOpen : 0;
    return html`<om-layer-group .alpha=${1 - open}
        >${renderLayers(this.layers)}</om-layer-group
      >${
        this.nestedLayout && open > 0
          ? html`<om-nested-diagram
              .layout=${this.nestedLayout}
              .box=${coordSystemSize(this.coordinateSystem)}
              .boxScale=${
                applyPlacement(this.placement, this.coordinateSystem).scale
              }
              .progress=${open}
              .worldPerPixel=${this.openWorldPerPixel}
            ></om-nested-diagram>`
          : nothing
      }<slot></slot>`;
  }

  override willUpdate(changed: Map<string, unknown>): void {
    super.willUpdate(changed);
    if (changed.has("classRef") || changed.has("nestedSource")) {
      this.nestedLayout = null;
      this.requestedClass = null;
    }
    if (
      changed.has("nestedSource") ||
      changed.has("placement") ||
      changed.has("coordinateSystem")
    ) {
      this.syncNesting();
    }
  }

  override updated(changed: Map<string, unknown>): void {
    super.updated(changed);
    if (changed.has("substitutions")) {
      this.substitutionsProvider.setValue(this.substitutions);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.viewWatch.dispose();
  }

  /**
   * Recompute the open fraction from the box's current on-screen size and,
   * on entering the fade band, fetch the class diagram. The box is measured
   * in the parent's units, which for a top-level component are diagram
   * units. A failed fetch is retried only after the box has left the band,
   * not on every pan inside it.
   */
  private syncNesting(): void {
    const ctx = this.sceneCtx;
    if (!this.nestedSource || !ctx) {
      this.nestingOpen = 0;
      return;
    }
    const worldPerPixel = ctx.worldPerPixel();
    const [[x1, y1], [x2, y2]] = this.placement.extent;
    const boxPx =
      Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) / worldPerPixel;
    const open = nestingProgress(boxPx);
    if (open !== this.nestingOpen) this.nestingOpen = open;
    if (open === 0) {
      if (this.nestedLayout === null) this.requestedClass = null;
      return;
    }
    if (
      this.nestedLayout !== null &&
      worldPerPixel !== this.openWorldPerPixel
    ) {
      this.openWorldPerPixel = worldPerPixel;
    }
    this.requestNested();
  }

  private requestNested(): void {
    const source = this.nestedSource;
    const className = this.classRef;
    if (!source || className === "" || this.requestedClass === className) {
      return;
    }
    this.requestedClass = className;
    source(className).then(
      (layout) => {
        if (this.nestedSource === source && this.classRef === className) {
          this.openWorldPerPixel = this.sceneCtx?.worldPerPixel() ?? 1;
          this.nestedLayout = layout;
        }
      },
      () => {
        // Stays an icon until the box leaves the band and comes back.
      },
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-component": OmComponent;
  }
}
