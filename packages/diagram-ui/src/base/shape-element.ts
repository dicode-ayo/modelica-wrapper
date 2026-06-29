import { LitElement, css, html, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { ContextConsumer, ContextProvider, consume } from "@lit/context";
import type { Container } from "pixi.js";
import type {
  CoordinateSystem,
  IconLayer,
  Placement,
} from "@dicode/omc-client";

import { parentNodeContext } from "./parent-node-context.js";
import { OmShapeNode } from "./shape-node.js";
import { renderLayers } from "../primitives/render-shape.js";
import { sceneContext, type SceneContext } from "../scene/scene-context.js";
import {
  viewStateContext,
  type ViewStateStore,
} from "../scene/view-state-store.js";

/**
 * Base class for `<om-component>`, `<om-connector>`, and other shape-
 * carrying entities. Bridges the Lit lifecycle to an `OmShapeNode`:
 *
 *  - Consumes the parent `Container` from the Lit context.
 *  - Provides its own entity `Container` as the parent context for
 *    children (`<om-rectangle>`, `<om-text>`, …, plus nested
 *    `<om-connector>` / labels) — children attach in the entity's local
 *    icon coordinate system.
 *  - Renders each shape in `layers` as a primitive custom element. Each
 *    primitive owns its own `Graphics` and lifecycle, so an OMC roundtrip
 *    on a single shape only rebuilds that shape.
 *
 * Subclasses only need to:
 *   - Pick a `babylonNodeName` for the entity's canonical `om-<kind>:<id>`
 *     name (which also tags its picking identity)
 *   - Optionally override `onShapeNodeReady(node)` to add extra geometry
 *     (e.g. the port-indicator dot on `<om-connector>`)
 */
export abstract class OmShapeElement extends LitElement {
  static override styles = css`
    :host {
      display: contents;
    }
  `;

  /** Modelica placement of this entity in its parent's coord system. */
  @property({ attribute: false })
  placement: Placement = {
    extent: [
      [-10, -10],
      [10, 10],
    ],
  };

  /** Icon shape layers (ancestor-first / host-last). */
  @property({ attribute: false })
  layers: IconLayer[] = [];

  /** Coordinate system declared by the icon's host class. */
  @property({ attribute: false })
  coordinateSystem: CoordinateSystem | undefined = undefined;

  /**
   * Stroke-width multiplier kept on the public API for forward-compat with
   * the previous SVG renderer. The primitives renderer currently ignores it
   * — line widths are taken directly from the Modelica annotations. Kept as
   * a property so existing host code that sets it doesn't fail.
   */
  @property({ type: Number, attribute: "line-thickness-scale" })
  lineThicknessScale: number | undefined = undefined;

  /** Selection state — purely a flag for now (E2 wires visuals). */
  @property({ type: Boolean, reflect: true })
  selected = false;

  /** Read-only flag forwarded to the interaction manager in stage E. */
  @property({ type: Boolean, reflect: true })
  readonly = false;

  @consume({ context: parentNodeContext, subscribe: true })
  protected parentTransform: Container | null = null;

  @consume({ context: sceneContext, subscribe: true })
  protected sceneCtx: SceneContext | null = null;

  protected readonly childContextProvider = new ContextProvider(this, {
    context: parentNodeContext,
    initialValue: null,
  });

  protected shapeNode: OmShapeNode | null = null;

  /** Unsubscribe from the view-state store; rebound when the context
   *  resolves to a new store (mount, scene teardown, hot reload). */
  private viewUnsub: (() => void) | null = null;

  constructor() {
    super();
    // Selection handles are screen-pixel sized, so a zoom/pan (which
    // changes the world-per-pixel ratio) has to re-rescale them. Rather
    // than have the host walk the tree, each shape subscribes to the
    // scene's view-state store and rescales its own handles — a no-op
    // unless it's currently selected. Behaviour-subject semantics: the
    // callback fires immediately with the current snapshot on connect.
    new ContextConsumer(this, {
      context: viewStateContext,
      subscribe: true,
      callback: (store) => this.resubscribeViewState(store),
    });
  }

  private resubscribeViewState(store: ViewStateStore | null): void {
    this.viewUnsub?.();
    this.viewUnsub = store
      ? store.subscribe(() => this.shapeNode?.rescaleSelectionHandles())
      : null;
  }

  protected abstract babylonNodeName(): string;

  /** Hook for subclasses to add extra geometry to the shape. */
  protected onShapeNodeReady(_node: OmShapeNode): void {
    /* default: no-op */
  }

  /**
   * Paint-order offset used to layer entities. The default `0` puts
   * components on the diagram plane; subclasses override to lift themselves
   * in front, e.g. connectors render on top of components. More negative
   * values render further in front (`OmShapeNode` inverts the sign into a
   * Pixi `zIndex`).
   */
  protected zOffset(): number {
    return 0;
  }

  override render(): TemplateResult {
    return html`${renderLayers(this.layers)}<slot></slot>`;
  }

  override updated(_changed: Map<string, unknown>): void {
    this.ensureShapeNode();
    if (this.shapeNode) {
      this.shapeNode.setPlacement(
        this.placement,
        this.coordinateSystem,
        this.zOffset(),
      );
      this.shapeNode.setSelected(this.selected);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.viewUnsub?.();
    this.viewUnsub = null;
    this.shapeNode?.dispose();
    this.shapeNode = null;
    this.childContextProvider.setValue(null);
  }

  private ensureShapeNode(): void {
    if (this.shapeNode) {
      return;
    }
    const parent = this.parentTransform;
    const ctx = this.sceneCtx;
    if (!parent || !ctx) {
      return;
    }
    this.shapeNode = new OmShapeNode(ctx, parent, this.babylonNodeName());
    this.childContextProvider.setValue(this.shapeNode.transform);
    this.onShapeNodeReady(this.shapeNode);
  }
}
