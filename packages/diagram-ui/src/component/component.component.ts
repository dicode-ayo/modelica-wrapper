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
import {
  lateFadeProgress,
  nestingPrefetches,
  nestingProgress,
} from "../nesting/nesting-math.js";
import type {
  NestingChangeDetail,
  NestingView,
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
 *     const cls = layout.classes[componentInstance.classRef];
 *     <om-component
 *       nodeId="R1"
 *       .nestedClass=${classNameOf(layout, componentInstance.classRef)}
 *       .nestedSource=${componentInstance.openable ? source : null}
 *       .placement=${componentInstance.placement}
 *       .layers=${cls?.iconLayers ?? []}
 *       .coordinateSystem=${cls?.coordinateSystem}>
 *       <om-connector nodeId="p" ...></om-connector>
 *       <om-connector nodeId="n" ...></om-connector>
 *     </om-component>
 *
 * With a `nestedSource`, zooming in cross-fades the icon to the class's own
 * diagram. The diagram is fetched a little before the box starts to open, and
 * one that lands after the box has opened fades in over a short beat rather
 * than popping. Ports stay on the icon's placement; `om-nesting-change` tells
 * the host what the box draws, so its wires can meet the class's own ports.
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

  /** The class name `nestedSource` is asked for — a name, not a catalog key. */
  @property({ attribute: false }) nestedClass = "";

  /** `null` keeps the component an icon. */
  @property({ attribute: false })
  nestedSource: NestedDiagramSource | null = null;

  @state() private nestedLayout: DiagramLayout | null = null;

  /** Size-driven open fraction; `effectiveOpen` is what is drawn. */
  @state() private nestingOpen = 0;

  /** Scales `nestingOpen` while a late-landing diagram fades in. */
  @state() private lateFade = 1;

  private lateFadeFrame: number | null = null;

  /** Big enough on screen that the diagram should be fetched, open or not. */
  private nearBand = false;

  @state() private openWorldPerPixel = 1;

  /** `undefined` until first announced: a remount clears a stale host entry. */
  private announcedView: NestingView | null | undefined = undefined;

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
    const open = this.effectiveOpen;
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
    if (changed.has("nestedClass") || changed.has("nestedSource")) {
      this.nestedLayout = null;
      this.requestedClass = null;
      this.cancelLateFade();
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
      changed.has("nestedClass") ||
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

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.cancelLateFade();
  }

  private get effectiveOpen(): number {
    return this.nestedLayout ? this.nestingOpen * this.lateFade : 0;
  }

  private announceView(): void {
    const layout = this.nestedLayout;
    const progress = this.effectiveOpen;
    const view = layout && progress > 0 ? { layout, progress } : null;
    const last = this.announcedView;
    if (
      last !== undefined &&
      view?.layout === last?.layout &&
      view?.progress === last?.progress
    ) {
      return;
    }
    this.announcedView = view;
    const detail: NestingChangeDetail = { nodeId: this.nodeId, view };
    this.dispatchEvent(
      new CustomEvent("om-nesting-change", { detail, bubbles: true }),
    );
  }

  protected override onViewChanged(): void {
    super.onViewChanged();
    this.syncNesting();
  }

  /** A failed fetch is retried only after the box drops below the prefetch size, not on every pan. */
  private syncNesting(): void {
    const ctx = this.sceneCtx;
    if (!this.nestedSource || !ctx) {
      this.nestingOpen = 0;
      this.nearBand = false;
      this.cancelLateFade();
      return;
    }
    const worldPerPixel = ctx.worldPerPixel();
    const { width, height } = extentToRect(this.placement.extent);
    const sizePx = Math.min(width, height) / worldPerPixel;
    const open = nestingProgress(sizePx);
    this.nestingOpen = open;
    this.nearBand = nestingPrefetches(sizePx);
    if (open === 0) this.cancelLateFade();
    if (!this.nearBand) {
      if (this.nestedLayout === null) this.requestedClass = null;
      return;
    }
    if (open > 0 && this.nestedLayout !== null) {
      this.openWorldPerPixel = worldPerPixel;
    }
    this.requestNested();
  }

  /**
   * Re-fetch if the diagram was built from `className` (`null`: any). Open, the
   * old diagram stays up until the new one lands; closed, it is dropped, and
   * fetched afresh if the box is big enough to prefetch. A fetch in flight is
   * the source's to re-run.
   */
  refreshNested(className: string | null): void {
    const layout = this.nestedLayout;
    if (layout === null) return;
    if (className !== null && !layoutDependsOn(layout, className)) return;
    this.requestedClass = null;
    if (this.nestingOpen === 0) this.nestedLayout = null;
    if (this.nearBand) this.requestNested();
  }

  private requestNested(): void {
    const source = this.nestedSource;
    const className = this.nestedClass;
    if (!source || className === "" || this.requestedClass === className) {
      return;
    }
    this.requestedClass = className;
    source(className).then(
      (layout) => {
        if (this.nestedSource === source && this.nestedClass === className) {
          const late = this.nestedLayout === null;
          this.nestedLayout = layout;
          this.syncNesting();
          if (late && this.nestingOpen > 0) this.startLateFade();
        }
      },
      () => {
        // Stays an icon until the box drops below the prefetch size and comes back.
      },
    );
  }

  /** A box already part-open would otherwise show the diagram at once. */
  private startLateFade(): void {
    this.cancelLateFade();
    this.lateFade = 0;
    let start: number | undefined;
    const step = (now: number): void => {
      start ??= now;
      this.lateFade = lateFadeProgress(now - start);
      this.lateFadeFrame =
        this.lateFade < 1 ? requestAnimationFrame(step) : null;
    };
    this.lateFadeFrame = requestAnimationFrame(step);
  }

  private cancelLateFade(): void {
    if (this.lateFadeFrame !== null) {
      cancelAnimationFrame(this.lateFadeFrame);
      this.lateFadeFrame = null;
    }
    this.lateFade = 1;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-component": OmComponent;
  }
}
