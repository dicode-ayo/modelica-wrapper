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
import {
  NESTING_CHANGE,
  type NestingChangeDetail,
  type NestingView,
} from "../nesting/nested-ports.js";
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
 * With a `nestedSource`, zooming in cross-fades the icon to the class's own
 * diagram. Ports stay on the icon's placement; the host is told what the box
 * draws through `NESTING_CHANGE`, so its wires can meet the class's own ports.
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

  @property() classRef = "";

  /** `null` keeps the component an icon. */
  @property({ attribute: false })
  nestedSource: NestedDiagramSource | null = null;

  @state() private nestedLayout: DiagramLayout | null = null;

  @state() private nestingOpen = 0;

  @state() private openWorldPerPixel = 1;

  /** Last view announced through `NESTING_CHANGE`. */
  private announcedView: NestingView | null = null;

  /** Set once a fetch is issued, so the element asks once per approach. */
  private requestedClass: string | null = null;

  /** Kept by reference so a progress-only render leaves these inputs unchanged. */
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
    if (
      changed.has("classRef") ||
      changed.has("nestedSource") ||
      changed.has("placement")
    ) {
      this.syncNesting();
    }
  }

  override updated(changed: Map<string, unknown>): void {
    super.updated(changed);
    if (changed.has("substitutions")) {
      this.substitutionsProvider.setValue(this.substitutions);
    }
    this.announceView();
  }

  private announceView(): void {
    const layout = this.nestedLayout;
    const progress = this.nestingOpen;
    const view = layout && progress > 0 ? { layout, progress } : null;
    const last = this.announcedView;
    if (view?.layout === last?.layout && view?.progress === last?.progress) {
      return;
    }
    this.announcedView = view;
    const detail: NestingChangeDetail = { nodeId: this.nodeId, view };
    this.dispatchEvent(
      new CustomEvent(NESTING_CHANGE, { detail, bubbles: true }),
    );
  }

  protected override onViewChanged(): void {
    super.onViewChanged();
    this.syncNesting();
  }

  /** A failed fetch is retried only after the box leaves the band, not on every pan. */
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
   * Re-fetch if the diagram was built from `className` (`null`: any). Open, the
   * old diagram stays up until the new one lands; closed, it is dropped. A
   * fetch in flight is the source's to re-run.
   */
  refreshNested(className: string | null): void {
    const layout = this.nestedLayout;
    if (layout === null) return;
    if (className !== null && !layoutDependsOn(layout, className)) return;
    this.requestedClass = null;
    if (this.nestingOpen === 0) {
      this.nestedLayout = null;
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
    source(className).then(
      (layout) => {
        if (this.nestedSource === source && this.classRef === className) {
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
