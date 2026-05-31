import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ContextProvider, consume } from "@lit/context";
import type { Texture } from "@babylonjs/core";
import { renderIconLayersToSvg, type RenderOptions } from "@dicode/diagram-svg";
import type { CoordinateSystem, IconLayer } from "@dicode/omc-client";

import { sceneContext, type SceneContext } from "../scene/scene-context.js";
import {
  IconCache,
  type IconRequest,
  type RasterizeFn,
  type SvgRenderFn,
} from "./icon-cache.js";
import {
  iconProviderContext,
  type IconProviderContext,
} from "./icon-provider-context.js";
import { rasterizeSvgToTexture } from "./svg-rasterizer.js";

/**
 * Default base resolution for the rasterised PNG behind each icon
 * texture. 1024 × 1024 RGBA8 + auto-generated mipmap chain ≈ 5.3 MB
 * GPU memory per unique class. With cache dedup across instances,
 * a PID-class diagram (~9 unique classes) consumes ~50 MB — fine.
 * Larger diagrams should override via the `<om-icon-provider>`'s
 * `resolution` property.
 *
 * 512 (the previous default) saved memory but produced visibly
 * blurry icons even with trilinear mipmap sampling, especially on
 * the LimPID / SpringDamper fixtures that have small detail.
 */
const DEFAULT_RENDER_SIZE = 1024;

function buildRenderSvg(
  size: number,
  lineThicknessScale: number | undefined,
): SvgRenderFn {
  return (layers, coordinateSystem) => {
    // `size` is baked into the SVG's root `width`/`height` so the
    // browser image decoder doesn't report naturalWidth = 0 when
    // loading the data URL into an <img>.
    const opts: RenderOptions = { size };
    if (coordinateSystem) {
      opts.coordinateSystem = coordinateSystem;
    }
    if (lineThicknessScale !== undefined) {
      opts.lineThicknessScale = lineThicknessScale;
    }
    return renderIconLayersToSvg(layers, opts);
  };
}

/**
 * `<om-icon-provider>` — host element that provides an
 * `IconProviderContext` to its descendants. Typical usage wraps the
 * scene element:
 *
 *     <om-icon-provider>
 *       <om-scene>
 *         <om-component .shapes=${...}></om-component>
 *         ...
 *       </om-scene>
 *     </om-icon-provider>
 *
 * The provider holds an `IconCache` keyed by SVG output; downstream
 * entity elements (added in D-stage) call `textureFor(req)` to obtain
 * a `Promise<Texture>` and apply it to their plane mesh once resolved.
 *
 * Both the SVG renderer and the rasteriser are injectable via
 * properties so tests can replace them with deterministic stubs.
 */
@customElement("om-icon-provider")
export class OmIconProvider extends LitElement {
  static override styles = css`
    :host {
      display: contents;
    }
  `;

  /**
   * Override the SVG renderer (default: `renderIconLayersToSvg` from
   * `@dicode/diagram-svg`). Useful for tests and custom
   * styling layers. `undefined` is allowed and falls back to the
   * default — important because the parent host element
   * (`<om-graphical-layout>`) forwards its own optional property
   * verbatim and would otherwise clobber the default.
   */
  @property({ attribute: false })
  renderSvg: SvgRenderFn | undefined = undefined;

  /** Same fallback behaviour as `renderSvg`. */
  @property({ attribute: false })
  rasterize: RasterizeFn | undefined = undefined;

  /**
   * Base pixel size for the rasterised PNG behind each icon texture
   * (RGBA + mipmap chain). Higher = sharper at all zoom levels but
   * more GPU memory per unique class. Default `1024`.
   *
   * Set lower (e.g., 512) for very large diagrams with many unique
   * classes; higher (e.g., 2048) for kiosk / print-quality displays.
   */
  @property({ type: Number })
  resolution: number = DEFAULT_RENDER_SIZE;

  /**
   * Stroke-width scale forwarded to `renderIconLayersToSvg` when the
   * provider builds its default SVG renderer. Only used when the
   * caller does NOT supply a custom `renderSvg` override. `undefined`
   * keeps the renderer's own default (currently `4`).
   */
  @property({ type: Number, attribute: "line-thickness-scale" })
  lineThicknessScale: number | undefined = undefined;

  @consume({ context: sceneContext, subscribe: true })
  private sceneCtx: SceneContext | null = null;

  private cache: IconCache | null = null;

  private readonly contextProvider = new ContextProvider(this, {
    context: iconProviderContext,
    initialValue: null,
  });

  override render() {
    return html`<slot></slot>`;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.rebuildCache();
  }

  override updated(changed: Map<string, unknown>): void {
    if (
      changed.has("renderSvg") ||
      changed.has("rasterize") ||
      changed.has("resolution") ||
      changed.has("lineThicknessScale")
    ) {
      void this.cache?.destroy();
      this.rebuildCache();
    }
  }

  private rebuildCache(): void {
    const size = this.resolution;
    // Default renderer reused but baked with the current resolution so
    // the SVG width/height match the rasterizer pixel size — keeps
    // the cache key stable and avoids browsers down-scaling on draw.
    const renderSvg =
      this.renderSvg ?? buildRenderSvg(size, this.lineThicknessScale);
    this.cache = new IconCache(
      renderSvg,
      this.rasterize ?? rasterizeSvgToTexture,
    );
    this.contextProvider.setValue(this.buildContext());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    void this.cache?.destroy();
    this.cache = null;
    this.contextProvider.setValue(null);
  }

  /** Live cache (for tests + tooling). */
  get iconCache(): IconCache | null {
    return this.cache;
  }

  private buildContext(): IconProviderContext {
    const get = (): {
      cache: IconCache;
      ctx: SceneContext;
      size: number;
    } | null => {
      if (!this.cache || !this.sceneCtx) {
        return null;
      }
      return { cache: this.cache, ctx: this.sceneCtx, size: this.resolution };
    };
    return {
      textureFor(req: IconRequest): Promise<Texture> {
        const live = get();
        if (!live) {
          return Promise.reject(
            new Error("icon-provider not connected to a scene"),
          );
        }
        const merged: IconRequest =
          req.size === undefined ? { ...req, size: live.size } : req;
        return live.cache.resolve(live.ctx.scene, merged);
      },
      textureForLayers(
        layers: IconLayer[],
        coordinateSystem?: CoordinateSystem,
      ): Promise<Texture> {
        const live = get();
        if (!live) {
          return Promise.reject(
            new Error("icon-provider not connected to a scene"),
          );
        }
        return live.cache.resolve(live.ctx.scene, {
          layers,
          coordinateSystem,
          size: live.size,
        });
      },
    };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-icon-provider": OmIconProvider;
  }
}
