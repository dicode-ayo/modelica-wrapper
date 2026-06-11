import { LitElement, css, html, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { ContextConsumer, ContextProvider, consume } from "@lit/context";
import type {
  CoordinateSystem,
  IconLayer,
  Placement,
} from "@dicode/omc-client";

import { parentNodeContext } from "./parent-node-context.js";
import { OmShapeNode } from "./shape-node.js";
import { renderLayers } from "../primitives/render-shape.js";
import {
  viewStateContext,
  type ViewStateStore,
} from "../scene/view-state-store.js";

/**
 * Base class for `<om-component>`, `<om-connector>`, and other shape-
 * carrying entities. Bridges the Lit lifecycle to a Babylon `OmShapeNode`:
 *
 *  - Consumes the parent `TransformNode` from the Lit context.
 *  - Provides its own `TransformNode` as the parent context for
 *    children (`<om-rectangle>`, `<om-text>`, …, plus nested
 *    `<om-connector>` / labels) — children attach in the entity's
 *    local icon coordinate system.
 *  - Renders each shape in `layers` as a primitive custom element.
 *    Each primitive owns its own Babylon meshes and lifecycle, so an
 *    OMC roundtrip on a single shape only rebuilds that shape.
 *
 * Subclasses only need to:
 *   - Pick a `nodeName` for debugging
 *   - Optionally override `onShapeNodeReady(node)` to add extra meshes
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
   * Multiplier applied to every shape's `lineThickness` to size stroke
   * widths, matching `@dicode/diagram-svg`'s `lineThicknessScale`.
   * Threaded down to the stroked primitives via `renderLayers`.
   */
  @property({ type: Number, attribute: "line-thickness-scale" })
  lineThicknessScale: number | undefined = undefined;

  @property({ type: Boolean, reflect: true })
  selected = false;

  /** Read-only flag forwarded to the interaction manager in stage E. */
  @property({ type: Boolean, reflect: true })
  readonly = false;

  @consume({ context: parentNodeContext, subscribe: true })
  protected parentTransform: import("@babylonjs/core").TransformNode | null =
    null;

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

  /** Hook for subclasses to add extra Babylon geometry to the shape. */
  protected onShapeNodeReady(_node: OmShapeNode): void {
    /* default: no-op */
  }

  /**
   * Z-axis offset (in parent local units) used to layer entities. The
   * default `0` puts components on the diagram plane; subclasses
   * override to lift themselves slightly toward the camera (which sits
   * on +Z), e.g. connectors render on top of components.
   */
  protected zOffset(): number {
    return 0;
  }

  override render(): TemplateResult {
    return html`${renderLayers(this.layers, 0, this.lineThicknessScale)}<slot
      ></slot>`;
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
    if (!parent) {
      return;
    }
    const scene = parent.getScene();
    this.shapeNode = new OmShapeNode(scene, parent, this.babylonNodeName());
    this.childContextProvider.setValue(this.shapeNode.transform);
    this.onShapeNodeReady(this.shapeNode);
  }
}
