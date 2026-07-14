import Image, { type ImageOptions } from "@tiptap/extension-image";

export interface ModelicaImageStorage {
  /** Map an image `src` to a loadable one (a `modelica://` URI → `data:` URI). */
  resolveSrc: (src: string) => string;
}

/**
 * The `Image` node, extended with a node view that renders the `<img>` with a
 * *resolved* `src` (a host-provided `data:` URI for `modelica://…` resources)
 * while the node's stored `src` stays the original `modelica://` — the node view
 * only touches the editor DOM, and `getHTML()`/serialization use the schema's
 * `renderHTML`, so the annotation keeps its literal URIs. `resolveSrc` lives in
 * per-editor storage and is set by the component from the `resources` map; it
 * defaults to identity, so a `modelica://` URI with no resolution just renders
 * broken rather than throwing.
 */
export const ModelicaImage = Image.extend<ImageOptions, ModelicaImageStorage>({
  addStorage() {
    return { resolveSrc: (src) => src };
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("img");
      const attrs = node.attrs as {
        src?: unknown;
        alt?: unknown;
        title?: unknown;
      };
      if (typeof attrs.alt === "string") dom.alt = attrs.alt;
      if (typeof attrs.title === "string") dom.title = attrs.title;
      if (typeof attrs.src === "string") {
        dom.setAttribute("src", this.storage.resolveSrc(attrs.src));
      }
      return { dom };
    };
  },
});
