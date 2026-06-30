import { customElement, property } from "lit/decorators.js";
import { ImageSource, Sprite, Texture, type Container } from "pixi.js";
import type { BitmapShape } from "@dicode/omc-client";

import {
  OmShapePrimitive,
  extentEntityBounds,
  type EntityBounds,
} from "./shape-primitive.js";
import { extentToRect } from "./shape-utils.js";

/**
 * `<om-bitmap>` — one Modelica `BitmapShape`. Loads either a base64
 * `imageSource` or a remote `fileName` into a `Texture` and paints it on a
 * `Sprite` sized to the shape extent. The sprite counter-flips locally
 * (`scale.y < 0`) so the image stays upright under the diagram root's Y-flip.
 */
@customElement("om-bitmap")
export class OmBitmap extends OmShapePrimitive {
  @property({ attribute: false })
  shape: BitmapShape | null = null;

  protected override fingerprint(): string {
    return JSON.stringify(this.shape);
  }

  protected override entityKind(): string {
    return "bitmap";
  }

  protected override entityBounds(): EntityBounds | null {
    return this.shape ? extentEntityBounds(this.shape) : null;
  }

  protected override buildMeshes(
    parent: Container,
    z: number,
    inEntityFrame = false,
  ): void {
    const s = this.shape;
    if (!s) {
      return;
    }
    const { x, y, width, height } = extentToRect(s.extent);
    if (width <= 0 || height <= 0) {
      return;
    }
    const url = resolveBitmapUrl(s);
    if (!url) {
      return;
    }

    const baseName = `om-bitmap.${this.zOrder}`;
    const root = this.graphicRoot(
      parent,
      s,
      `${baseName}.gi`,
      inEntityFrame,
      z,
    );
    const sprite = new Sprite(Texture.EMPTY);
    sprite.label = baseName;
    sprite.eventMode = "none";
    sprite.zIndex = z;
    sprite.anchor.set(0.5);
    sprite.position.set(x + width / 2, y + height / 2);
    root.addChild(sprite);

    // The decode is async; a rebuild before it settles must not paint the
    // stale image onto the disposed sprite.
    let canceled = false;
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    img
      .decode()
      .then(() => {
        if (canceled) {
          return;
        }
        const texture = new Texture({
          source: new ImageSource({ resource: img }),
        });
        sprite.texture = texture;
        const tw = texture.width || 1;
        const th = texture.height || 1;
        sprite.scale.set(width / tw, -(height / th));
        this.requestRender();
      })
      .catch(() => {});

    this.resources.push({
      dispose(): void {
        canceled = true;
        const texture = sprite.texture;
        sprite.destroy();
        if (texture !== Texture.EMPTY) {
          texture.destroy(true);
        }
      },
    });
  }
}

function resolveBitmapUrl(s: BitmapShape): string | undefined {
  const src = s.imageSource;
  if (typeof src === "string" && src.length > 0) {
    if (src.startsWith("data:")) return src;
    // Raw base64 PNG signature: `iVBOR...`. Wrap it so the image loader
    // recognises the encoding.
    if (src.startsWith("iVBOR")) return `data:image/png;base64,${src}`;
    return src;
  }
  if (typeof s.fileName === "string" && s.fileName.length > 0) {
    return s.fileName;
  }
  return undefined;
}

declare global {
  interface HTMLElementTagNameMap {
    "om-bitmap": OmBitmap;
  }
}
