import { LitElement, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { Container, Sprite, Texture } from "pixi.js";
import type { CoordinateSystem, IconLayer } from "@dicode/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import { sceneContext, type SceneContext } from "../scene/scene-context.js";
import {
  iconProviderContext,
  type IconProviderContext,
} from "../icon-provider/icon-provider-context.js";

/**
 * `<om-debug-plane>` — diagnostic single-sprite element used by the
 * `diagram-ui/IconDebug` stories. Each story passes a different
 * `textureFactory` so we can isolate which step of the texture
 * pipeline succeeds vs. fails:
 *
 *   1. `null` → bare sprite tinted with `fallbackColor` (sanity check
 *      that scene + sprite work)
 *   2. canvas-baked `Texture` → tests canvas → texture upload
 *   3. PNG `data:` URL → tests PNG decode
 *   4. SVG `data:` URL → tests SVG decode (current production path)
 *
 * Placement is in diagram coords (`x`, `y`, `size`). `parentNodeContext`
 * is consumed so the element can live inside `<om-scene>` as a sibling
 * of grid + entities. The sprite counter-flips `scale.y` against the
 * `worldRoot` +y-up flip so textures render upright — making this probe
 * a direct check for flip regressions.
 */
@customElement("om-debug-plane")
export class OmDebugPlane extends LitElement {
  static override styles = css`
    :host {
      display: none;
    }
  `;

  @property({ type: Number }) x = 0;
  @property({ type: Number }) y = 0;
  @property({ type: Number }) size = 20;

  /**
   * Tint (`0xRRGGBB`) applied while no texture is bound. When a texture
   * loads, the tint is reset to white. Bright red default so a story
   * without a `textureFactory` immediately shows.
   */
  @property({ attribute: false })
  fallbackColor = 0xd93333;

  /**
   * Async factory that returns the texture to display, or `null` for
   * "no texture" (fallbackColor tint only).
   *
   * If both `textureFactory` and `layers` are set, `layers` wins —
   * lets a story drop into the production icon-provider path with
   * one line.
   */
  @property({ attribute: false })
  textureFactory: (() => Texture | null | Promise<Texture | null>) | undefined =
    undefined;

  /**
   * Drives the sprite through the production `iconProviderContext`
   * instead of an inline factory. Lets the IconProvider stories show
   * exactly what `<om-component>` would see for a given fixture.
   */
  @property({ attribute: false })
  layers: IconLayer[] | undefined = undefined;

  /** Optional coordinate system forwarded to the icon-provider when
   *  `layers` is set. Falls back to the renderer's default extent. */
  @property({ attribute: false })
  coordinateSystem: CoordinateSystem | undefined = undefined;

  @consume({ context: parentNodeContext, subscribe: true })
  private parentContainer: Container | null = null;

  @consume({ context: sceneContext, subscribe: true })
  private sceneCtx: SceneContext | null = null;

  @consume({ context: iconProviderContext, subscribe: true })
  private iconProvider: IconProviderContext | null = null;

  private sprite: Sprite | null = null;
  private pendingToken: symbol | null = null;

  override render() {
    return nothing;
  }

  override updated(): void {
    this.ensureSprite();
    this.applyTransform();
    void this.refreshTexture();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.pendingToken = null;
    // The texture is owned by the icon-provider / story factory.
    this.sprite?.destroy({ texture: false });
    this.sprite = null;
    this.sceneCtx?.requestRender();
  }

  private ensureSprite(): void {
    if (this.sprite) {
      return;
    }
    const parent = this.parentContainer;
    if (!parent) {
      return;
    }
    const sprite = new Sprite(Texture.WHITE);
    sprite.label = "om-debug-plane";
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    sprite.tint = this.fallbackColor;
    parent.addChild(sprite);
    this.sprite = sprite;
  }

  private applyTransform(): void {
    const sprite = this.sprite;
    if (!sprite) {
      return;
    }
    sprite.position.set(this.x, this.y);
    sprite.width = this.size;
    sprite.height = this.size;
    // Counter-flip against the worldRoot +y-up flip so the texture is
    // upright. `width`/`height` are unsigned extents, so the sign lives
    // on the scale component directly.
    sprite.scale.y = -Math.abs(sprite.scale.y);
    this.sceneCtx?.requestRender();
  }

  private async refreshTexture(): Promise<void> {
    const sprite = this.sprite;
    if (!sprite) {
      return;
    }
    let source: (() => Texture | null | Promise<Texture | null>) | undefined;
    if (this.layers && this.layers.length > 0 && this.iconProvider) {
      const layers = this.layers;
      const coordinateSystem = this.coordinateSystem;
      const provider = this.iconProvider;
      source = () => provider.textureForLayers(layers, coordinateSystem);
    } else {
      source = this.textureFactory;
    }
    if (!source) {
      this.applyFallback(sprite);
      return;
    }
    const token = Symbol();
    this.pendingToken = token;
    try {
      const tex = await source();
      if (this.pendingToken !== token || this.sprite !== sprite) {
        return;
      }
      if (tex) {
        sprite.texture = tex;
        sprite.tint = 0xffffff;
        this.applyTransform();
      } else {
        this.applyFallback(sprite);
      }
    } catch (err) {
      console.error("[om-debug-plane] texture factory failed:", err);
      if (this.pendingToken === token && this.sprite === sprite) {
        this.applyFallback(sprite);
      }
    }
  }

  private applyFallback(sprite: Sprite): void {
    sprite.texture = Texture.WHITE;
    sprite.tint = this.fallbackColor;
    this.applyTransform();
  }

  /** Test accessor. */
  get debugSprite(): Sprite | null {
    return this.sprite;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-debug-plane": OmDebugPlane;
  }
}
