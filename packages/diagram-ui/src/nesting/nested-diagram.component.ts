import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { guard } from "lit/directives/guard.js";
import { ContextProvider, consume } from "@lit/context";
import { Container, Graphics } from "pixi.js";
import type { DiagramLayout } from "@dicode/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import { coordSystemSize, type Box } from "../base/placement-math.js";
import {
  renderLayoutContent,
  type LayoutContentOptions,
} from "../graphical-layout/render-entities.js";
import { interactionStateContext } from "../interaction/interaction-state.js";
import { sceneContext, type SceneContext } from "../scene/scene-context.js";
import { NESTING_CHROME, letterbox } from "./nesting-math.js";
import "../connection/connection.component.js";
import "../connector/connector.component.js";

/** Shared so `selectedKeys` keeps its identity across renders. */
const VIEW_ONLY: LayoutContentOptions = {
  selectedKeys: new Set(),
  readonly: true,
  editableShapes: false,
  lineThicknessScale: undefined,
  nestedSource: null,
  nesting: new Map(),
};

interface Mounted {
  root: Container;
  /** Cancels the placement scale so the stroke is even on both axes. */
  frameSpace: Container;
  frame: Graphics;
  content: Container;
}

/**
 * `<om-nested-diagram>` — a class's own diagram, letterboxed into `box` and
 * faded by `progress`. View only: nothing inside is pickable, and the host's
 * interaction state is shadowed so a host key like `edge:0` can't light a
 * nested entity with the same index. Content past the declared extent is
 * drawn, not clipped or refitted.
 */
@customElement("om-nested-diagram")
export class OmNestedDiagram extends LitElement {
  static override styles = css`
    :host {
      display: contents;
    }
  `;

  @property({ attribute: false }) layout: DiagramLayout | null = null;

  /** In the parent's icon coordinates. */
  @property({ attribute: false }) box: Box = coordSystemSize(undefined);

  /** Signed placement scale of the parent, undone so the content reads true. */
  @property({ attribute: false }) boxScale = { x: 1, y: 1 };

  /** Open fraction in `[0, 1]`. */
  @property({ type: Number }) progress = 0;

  /** Parent-space units per CSS px, for a screen-constant frame. */
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

  private mounted: Mounted | null = null;

  /** The class, not the instance. */
  get label(): string {
    return this.layout?.className ?? "";
  }

  get container(): Container | null {
    return this.mounted?.root ?? null;
  }

  get contentContainer(): Container | null {
    return this.mounted?.content ?? null;
  }

  override render(): TemplateResult {
    const layout = this.layout;
    if (!layout) return html``;
    // Progress and zoom only move or fade containers; content follows the layout.
    return html`${guard([layout], () => renderLayoutContent(layout, VIEW_ONLY))}`;
  }

  override updated(changed: Map<string, unknown>): void {
    const parent = this.parentTransform;
    // Lit can flush after disconnect, when the parent has destroyed this root.
    if (!parent || !this.isConnected) return;
    const fresh = this.mounted === null;
    const m = this.mounted ?? this.mount(parent);
    const layoutChanged = fresh || changed.has("layout");
    const boxChanged = fresh || changed.has("box") || changed.has("boxScale");
    if (layoutChanged) m.root.label = `nested:${this.label}`;
    if (fresh || changed.has("progress")) {
      m.root.alpha = this.progress;
      m.root.visible = this.progress > 0;
    }
    if (layoutChanged || boxChanged) {
      const fit = letterbox(
        coordSystemSize(this.layout?.coordinateSystem),
        this.box,
        this.boxScale,
      );
      m.content.scale.set(fit.scaleX, fit.scaleY);
      m.content.position.set(fit.x, fit.y);
    }
    if (boxChanged || changed.has("worldPerPixel")) this.drawFrame(m);
    this.sceneCtx?.requestRender();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    const m = this.mounted;
    this.mounted = null;
    this.contentProvider.setValue(null);
    if (!m) return;
    // Nested entities destroy their own nodes and may still flush against
    // `content`, so only what this element drew is destroyed.
    m.frameSpace.destroy({ children: true });
    m.content.removeFromParent();
    m.root.destroy();
  }

  private mount(parent: Container): Mounted {
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
    const mounted = { root, frameSpace, frame, content };
    this.mounted = mounted;
    this.contentProvider.setValue(content);
    return mounted;
  }

  private drawFrame({ frameSpace, frame }: Mounted): void {
    const sx = this.boxScale.x || 1;
    const sy = this.boxScale.y || 1;
    frameSpace.scale.set(1 / sx, 1 / sy);
    const width = Math.abs(this.box.width * sx);
    const height = Math.abs(this.box.height * sy);
    frame
      .clear()
      .rect(
        this.box.cx * sx - width / 2,
        this.box.cy * sy - height / 2,
        width,
        height,
      )
      .fill({
        color: NESTING_CHROME.fillColor,
        alpha: NESTING_CHROME.fillOpacity,
      })
      .stroke({
        color: NESTING_CHROME.strokeColor,
        width: NESTING_CHROME.strokeWidthPx * this.worldPerPixel,
      });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-nested-diagram": OmNestedDiagram;
  }
}
