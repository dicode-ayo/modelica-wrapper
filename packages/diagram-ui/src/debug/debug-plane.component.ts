import { LitElement, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  type Scene,
  type Texture,
  type TransformNode,
} from "@babylonjs/core";
import type {
  CoordinateSystem,
  IconLayer,
} from "@modelica-wrapper/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import {
  iconProviderContext,
  type IconProviderContext,
} from "../icon-provider/icon-provider-context.js";

/**
 * `<om-debug-plane>` — diagnostic single-plane element used by the
 * `diagram-ui/IconDebug` stories. Each story passes a different
 * `textureFactory` so we can isolate which step of the texture
 * pipeline succeeds vs. fails:
 *
 *   1. `null` → bare plane with `emissiveColor` only (sanity check
 *      that scene + camera + material + mesh work)
 *   2. procedural `DynamicTexture` → tests canvas → texture upload
 *   3. PNG `data:` URL via `canvas.toDataURL` → tests PNG decode
 *   4. SVG `data:` URL → tests SVG decode (current production path)
 *
 * The plane uses the same unlit material setup as `OmShapeNode` so
 * results are directly comparable to the real icon pipeline.
 *
 * Placement is in diagram coords (`x`, `y`, `size`). `parentNodeContext`
 * is consumed so the element can live inside `<om-scene>` as a sibling
 * of grid + entities.
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
   * Babylon `Color3` used as `emissiveColor` while no texture is
   * bound. When a texture loads, emissiveColor is forced to black
   * (same as `OmShapeNode`). Bright red default so a story without a
   * `textureFactory` immediately shows.
   */
  @property({ attribute: false })
  fallbackColor: Color3 = new Color3(0.85, 0.2, 0.2);

  /**
   * Async factory that returns the texture to display, or `null` for
   * "no texture" (fallbackColor only). Receives the live `Scene` so
   * the factory can construct DynamicTextures / Textures inline.
   *
   * If both `textureFactory` and `layers` are set, `layers` wins —
   * lets a story drop into the production icon-provider path with
   * one line.
   */
  @property({ attribute: false })
  textureFactory:
    | ((scene: Scene) => Texture | null | Promise<Texture | null>)
    | undefined = undefined;

  /**
   * Drives the plane through the production `iconProviderContext`
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
  private parentTransform: TransformNode | null = null;

  @consume({ context: iconProviderContext, subscribe: true })
  private iconProvider: IconProviderContext | null = null;

  private mesh: Mesh | null = null;
  private material: StandardMaterial | null = null;
  private pendingToken: symbol | null = null;

  override render() {
    return nothing;
  }

  override updated(): void {
    this.ensureMesh();
    this.applyTransform();
    void this.refreshTexture();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.pendingToken = null;
    this.mesh?.dispose();
    this.material?.dispose();
    this.mesh = null;
    this.material = null;
  }

  private ensureMesh(): void {
    if (this.mesh) {
      return;
    }
    const parent = this.parentTransform;
    if (!parent) {
      return;
    }
    const scene = parent.getScene();
    this.material = new StandardMaterial("om-debug-mat", scene);
    this.material.disableLighting = true;
    this.material.specularColor = new Color3(0, 0, 0);
    this.material.emissiveColor = this.fallbackColor.clone();
    this.material.backFaceCulling = false;
    this.material.useAlphaFromDiffuseTexture = true;

    this.mesh = MeshBuilder.CreatePlane(
      "om-debug-plane",
      { width: 1, height: 1, sideOrientation: Mesh.DOUBLESIDE },
      scene,
    );
    this.mesh.material = this.material;
    this.mesh.parent = parent;
    this.mesh.isPickable = false;
  }

  private applyTransform(): void {
    if (!this.mesh) {
      return;
    }
    this.mesh.position.set(this.x, this.y, 0);
    this.mesh.scaling.set(this.size, this.size, 1);
  }

  private async refreshTexture(): Promise<void> {
    const mesh = this.mesh;
    const material = this.material;
    if (!mesh || !material) {
      return;
    }
    // Resolve which source to use this update.
    let source: ((scene: Scene) => Texture | null | Promise<Texture | null>) | undefined;
    if (this.layers && this.layers.length > 0 && this.iconProvider) {
      const layers = this.layers;
      const coordinateSystem = this.coordinateSystem;
      const provider = this.iconProvider;
      source = () =>
        provider.textureForLayers(layers, coordinateSystem) as Promise<Texture>;
    } else {
      source = this.textureFactory;
    }
    if (!source) {
      material.emissiveTexture = null;
      material.diffuseTexture = null;
      material.emissiveColor.copyFrom(this.fallbackColor);
      return;
    }
    const token = Symbol();
    this.pendingToken = token;
    const scene = mesh.getScene();
    try {
      const tex = await source(scene);
      if (this.pendingToken !== token) {
        return;
      }
      if (tex) {
        tex.hasAlpha = true;
        material.emissiveTexture = tex;
        material.diffuseTexture = tex;
        material.emissiveColor.set(0, 0, 0);
      } else {
        material.emissiveTexture = null;
        material.diffuseTexture = null;
        material.emissiveColor.copyFrom(this.fallbackColor);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[om-debug-plane] texture factory failed:", err);
      if (this.pendingToken === token) {
        material.emissiveTexture = null;
        material.diffuseTexture = null;
        material.emissiveColor.copyFrom(this.fallbackColor);
      }
    }
  }

  /** Test accessors. */
  get debugMesh(): Mesh | null {
    return this.mesh;
  }
  get debugMaterial(): StandardMaterial | null {
    return this.material;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-debug-plane": OmDebugPlane;
  }
}
