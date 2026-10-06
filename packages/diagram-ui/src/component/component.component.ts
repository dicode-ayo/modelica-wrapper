import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { guard } from "lit/directives/guard.js";
import { ContextProvider } from "@lit/context";
import type { TextSubstitutions } from "@dicode/diagram-svg";
import type { DiagramLayout } from "@dicode/omc-client";
import { layoutDependsOn } from "@dicode/omc-client/layout";

import { OmShapeElement } from "../base/shape-element.js";
import "../base/layer-group.component.js";
import {
  applyPlacement,
  coordSystemSize,
  type Box,
} from "../base/placement-math.js";
import { substitutionsContext } from "../label/substitutions-context.js";
import type { NestedDiagramSource } from "../nesting/nested-diagram-source.js";
import { nestingProgress } from "../nesting/nesting-math.js";
import "../nesting/nested-diagram.component.js";
import { extentToRect } from "../primitives/shape-utils.js";

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

  /** Stamp of the latest fetch, so one superseded by a refresh lands nowhere. */
  private nestedRequest = 0;

  /** The box the nested view fills, and the signed scale it is placed at.
   *  Derived from `placement` / `coordinateSystem` and kept by reference, so
   *  a progress-only render leaves the nested view's inputs unchanged. */
  private nestedBox: Box = coordSystemSize(undefined);
  private nestedBoxScale = { x: 1, y: 1 };

  private readonly substitutionsProvider = new ContextProvider(this, {
    context: substitutionsContext,
    initialValue: null as TextSubstitutions | null,
  });

  protected override entityNodeName(): string {
    return this.nodeId ? `om-component:${this.nodeId}` : "om-component";
  }

  protected override renderIcon(): unknown {
    if (!this.nestedSource) return super.renderIcon();
    // The icon stays opaque until the diagram has arrived.
    const open = this.nestedLayout ? this.nestingOpen : 0;
    return html`<om-layer-group .alpha=${1 - open}
        >${guard([this.layers], () => super.renderIcon())}</om-layer-group
      >${
        open > 0
          ? html`<om-nested-diagram
              .layout=${this.nestedLayout}
              .box=${this.nestedBox}
              .boxScale=${this.nestedBoxScale}
              .progress=${open}
              .worldPerPixel=${this.openWorldPerPixel}
            ></om-nested-diagram>`
          : nothing
      }`;
  }

  override willUpdate(changed: Map<string, unknown>): void {
    super.willUpdate(changed);
    if (changed.has("classRef") || changed.has("nestedSource")) {
      this.nestedLayout = null;
      this.requestedClass = null;
    }
    if (changed.has("coordinateSystem")) {
      this.nestedBox = coordSystemSize(this.coordinateSystem);
    }
    if (changed.has("placement") || changed.has("coordinateSystem")) {
      const { scale } = applyPlacement(this.placement, this.coordinateSystem);
      const current = this.nestedBoxScale;
      if (scale.x !== current.x || scale.y !== current.y) {
        this.nestedBoxScale = scale;
      }
    }
    if (changed.has("nestedSource") || changed.has("placement")) {
      this.syncNesting();
    }
  }

  override updated(changed: Map<string, unknown>): void {
    super.updated(changed);
    if (changed.has("substitutions")) {
      this.substitutionsProvider.setValue(this.substitutions);
    }
  }

  protected override onViewChanged(): void {
    super.onViewChanged();
    this.syncNesting();
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
    const { width, height } = extentToRect(this.placement.extent);
    const open = nestingProgress(Math.min(width, height) / worldPerPixel);
    this.nestingOpen = open;
    if (open === 0) {
      if (this.nestedLayout === null) this.requestedClass = null;
      return;
    }
    if (this.nestedLayout !== null) this.openWorldPerPixel = worldPerPixel;
    this.requestNested();
  }

  /**
   * Re-fetch the class diagram if it was built from `className`'s definition
   * (`null`: whatever it was built from). While open, the stale diagram stays
   * up until the fresh one lands; while closed, it is dropped so the next
   * approach fetches.
   */
  refreshNested(className: string | null): void {
    if (this.requestedClass === null) return;
    const layout = this.nestedLayout;
    if (
      className !== null &&
      layout !== null &&
      !layoutDependsOn(layout, className)
    ) {
      return;
    }
    this.requestedClass = null;
    if (this.nestingOpen === 0) {
      this.nestedLayout = null;
      this.nestedRequest += 1;
      return;
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
    const request = (this.nestedRequest += 1);
    source(className).then(
      (layout) => {
        if (
          request === this.nestedRequest &&
          this.nestedSource === source &&
          this.classRef === className
        ) {
          this.nestedLayout = layout;
          this.syncNesting();
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
