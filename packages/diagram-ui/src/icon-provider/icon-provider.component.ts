import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ContextProvider, consume } from "@lit/context";
import type { Texture } from "@babylonjs/core";
import {
  renderIconLayersToSvg,
  type RenderOptions,
} from "@modelica-wrapper/diagram-svg";
import type { CoordinateSystem, IconLayer } from "@modelica-wrapper/omc-client";

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

const DEFAULT_RENDER_SIZE = 512;

// Pass `size` through to diagram-svg so the emitted root <svg>
// carries explicit width / height attributes. Without those, browser
// image decoders report `naturalWidth = 0` for the SVG and any
// downstream rasterisation paints nothing.
const defaultRenderSvg: SvgRenderFn = (layers, coordinateSystem) => {
  const opts: RenderOptions = { size: DEFAULT_RENDER_SIZE };
  if (coordinateSystem) {
    opts.coordinateSystem = coordinateSystem;
  }
  return renderIconLayersToSvg(layers, opts);
};

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
   * `@modelica-wrapper/diagram-svg`). Useful for tests and custom
   * styling layers.
   */
  @property({ attribute: false })
  renderSvg: SvgRenderFn = defaultRenderSvg;

  /**
   * Override the SVG-to-Texture rasteriser. Tests can stub this to
   * resolve a `RawTexture` (or any stand-in object) without needing a
   * real browser image-decoder.
   */
  @property({ attribute: false })
  rasterize: RasterizeFn = rasterizeSvgToTexture;

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
    this.cache = new IconCache(this.renderSvg, this.rasterize);
    this.contextProvider.setValue(this.buildContext());
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("renderSvg") || changed.has("rasterize")) {
      void this.cache?.destroy();
      this.cache = new IconCache(this.renderSvg, this.rasterize);
      this.contextProvider.setValue(this.buildContext());
    }
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
    const get = (): { cache: IconCache; ctx: SceneContext } | null => {
      if (!this.cache || !this.sceneCtx) {
        return null;
      }
      return { cache: this.cache, ctx: this.sceneCtx };
    };
    return {
      textureFor(req: IconRequest): Promise<Texture> {
        const live = get();
        if (!live) {
          return Promise.reject(
            new Error("icon-provider not connected to a scene"),
          );
        }
        return live.cache.resolve(live.ctx.scene, req);
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
        return live.cache.resolve(live.ctx.scene, { layers, coordinateSystem });
      },
    };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-icon-provider": OmIconProvider;
  }
}
