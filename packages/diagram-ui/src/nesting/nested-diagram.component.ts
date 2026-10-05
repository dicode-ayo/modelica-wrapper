import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ContextProvider, consume } from "@lit/context";
import { repeat } from "lit/directives/repeat.js";
import { Container, Graphics } from "pixi.js";
import type { DiagramLayout } from "@dicode/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import { coordSystemSize } from "../base/placement-math.js";
import {
  HOST_SHAPE_Z_BIAS,
  activeLayers,
  componentRepeatKey,
  renderComponent,
  renderConnection,
  renderStandaloneConnector,
  visibleComponents,
} from "../graphical-layout/render-entities.js";
import { interactionStateContext } from "../interaction/interaction-state.js";
import { renderLayers } from "../primitives/render-shape.js";
import { sceneContext, type SceneContext } from "../scene/scene-context.js";
import { NESTING_CHROME, letterbox, type Box } from "./nesting-math.js";
import "../connection/connection.component.js";
import "../connector/connector.component.js";

const NO_SELECTION: Set<string> = new Set();

/**
 * `<om-nested-diagram>` — a class's own diagram drawn inside the box of a
 * component of that class, letterboxed into `box` and faded by `progress`.
 *
 * View only: the subtree is `eventMode: "none"`, so no pick, hover or drag
 * reaches anything inside it, and it shields its content from the host's
 * interaction state so a host hover key such as `edge:0` cannot light up a
 * nested connection that happens to share the index.
 *
 * Content may reach past the class's declared extent (LimPID routes wires
 * to x = -120 inside a [-100, 100] system); it is neither clipped nor
 * refitted, so a nested view's scale never depends on where a wire runs.
 */
@customElement("om-nested-diagram")
export class OmNestedDiagram extends LitElement {
  static override styles = css`
    :host {
      display: contents;
    }
  `;

  /** The class's diagram, fetched with that class as its own root. */
  @property({ attribute: false }) layout: DiagramLayout | null = null;

  /** The box to fill, in the parent container's (icon) coordinates. */
  @property({ attribute: false }) box: Box = coordSystemSize(undefined);

  /** Signed per-axis scale the parent container is placed at, so the
   *  content can undo a squash or mirror and read true on screen. */
  @property({ attribute: false }) boxScale = { x: 1, y: 1 };

  /** Open fraction in `[0, 1]`. */
  @property({ type: Number }) progress = 0;

  /** Units per CSS px in the space the parent is placed in, for the
   *  screen-constant frame. */
  @property({ type: Number }) worldPerPixel = 1;

  @consume({ context: parentNodeContext, subscribe: true })
  private parentTransform: Container | null = null;

  @consume({ context: sceneContext, subscribe: true })
  private sceneCtx: SceneContext | null = null;

  private readonly contentProvider = new ContextProvider(this, {
    context: parentNodeContext,
    initialValue: null,
  });

  constructor() {
    super();
    new ContextProvider(this, {
      context: interactionStateContext,
      initialValue: null,
    });
  }

  private root: Container | null = null;
  /** Holds the frame in the parent's placement space, so its stroke is one
   *  width on both axes however the box is squashed. */
  private frameSpace: Container | null = null;
  private frame: Graphics | null = null;
  private content: Container | null = null;

  /** The class, not the instance: the content is the class as declared. */
  get label(): string {
    return this.layout?.className ?? "";
  }

  /** The faded, unpickable container holding the frame and the content. */
  get container(): Container | null {
    return this.root;
  }

  /** The letterboxed container the nested entities attach to. */
  get contentContainer(): Container | null {
    return this.content;
  }

  override render(): TemplateResult {
    const layout = this.layout;
    if (!layout) return html``;
    const entity = {
      selected: false,
      readonly: true,
      lineThicknessScale: undefined,
    };
    return html`
      ${renderLayers(activeLayers(layout), HOST_SHAPE_Z_BIAS)}
      ${repeat(visibleComponents(layout), componentRepeatKey, ([id, comp]) =>
        renderComponent(id, comp, layout, { ...entity, nestedSource: null }),
      )}
      ${repeat(
        Object.entries(layout.connectors),
        ([id]) => id,
        ([id, conn]) => renderStandaloneConnector(id, conn, layout, entity),
      )}
      ${repeat(
        layout.connections,
        (_, idx) => `conn:${idx}`,
        (conn, idx) => renderConnection(conn, idx, layout, NO_SELECTION),
      )}
    `;
  }

  override updated(): void {
    const parent = this.parentTransform;
    if (!parent) return;
    if (!this.root || this.root.destroyed) this.mount(parent);
    const root = this.root;
    const content = this.content;
    if (!root || !content) return;
    root.label = `nested:${this.label}`;
    root.alpha = this.progress;
    root.visible = this.progress > 0;

    const fit = letterbox(
      coordSystemSize(this.layout?.coordinateSystem),
      this.box,
      this.boxScale,
    );
    content.scale.set(fit.scaleX, fit.scaleY);
    content.position.set(fit.x, fit.y);
    this.drawFrame();
    this.sceneCtx?.requestRender();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // Nested entities dispose their own Pixi nodes as they disconnect, and
    // may still flush an update against `content`, so only what this
    // element drew is destroyed here.
    this.frameSpace?.destroy({ children: true });
    this.content?.removeFromParent();
    this.root?.destroy();
    this.root = null;
    this.frameSpace = null;
    this.frame = null;
    this.content = null;
    this.contentProvider.setValue(null);
  }

  private mount(parent: Container): void {
    const root = new Container({ label: "nested" });
    root.eventMode = "none";
    root.interactiveChildren = false;
    root.sortableChildren = true;
    const frameSpace = new Container({ label: "nested-frame-space" });
    const frame = new Graphics({ label: "nested-frame" });
    frameSpace.addChild(frame);
    const content = new Container({ label: "nested-content" });
    content.sortableChildren = true;
    root.addChild(frameSpace, content);
    parent.sortableChildren = true;
    parent.addChild(root);
    this.root = root;
    this.frameSpace = frameSpace;
    this.frame = frame;
    this.content = content;
    this.contentProvider.setValue(content);
  }

  private drawFrame(): void {
    const frameSpace = this.frameSpace;
    const frame = this.frame;
    if (!frameSpace || !frame) return;
    const sx = this.boxScale.x || 1;
    const sy = this.boxScale.y || 1;
    frameSpace.scale.set(1 / sx, 1 / sy);
    const width = Math.abs(this.box.width * sx);
    const height = Math.abs(this.box.height * sy);
    const style = NESTING_CHROME;
    frame
      .clear()
      .rect(
        this.box.cx * sx - width / 2,
        this.box.cy * sy - height / 2,
        width,
        height,
      )
      .fill({ color: style.fillColor, alpha: style.fillOpacity })
      .stroke({
        color: style.strokeColor,
        width: style.strokeWidthPx * this.worldPerPixel,
      });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-nested-diagram": OmNestedDiagram;
  }
}
