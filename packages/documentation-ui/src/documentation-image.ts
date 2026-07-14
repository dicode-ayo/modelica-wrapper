import Image, { type ImageOptions } from "@tiptap/extension-image";

export interface ModelicaImageStorage {
  /** Map an image `src` to a loadable one (a `modelica://` URI → `data:` URI). */
  resolveSrc: (src: string) => string;
}

declare module "@tiptap/core" {
  interface Storage {
    image: ModelicaImageStorage;
  }
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
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("img");
      // Copy every schema attribute (alt, title, width, height, …); only the
      // display `src` diverges from the model.
      for (const [name, value] of Object.entries(HTMLAttributes)) {
        if (value !== null && value !== undefined) {
          dom.setAttribute(name, String(value));
        }
      }
      const src = (node.attrs as { src?: unknown }).src;
      if (typeof src === "string") {
        // Stash the model src so the resolver can re-resolve the live image if
        // the `resources` map changes without a doc reload.
        dom.dataset[ORIGINAL_SRC_DATASET] = src;
        dom.setAttribute("src", this.storage.resolveSrc(src));
      }
      return { dom };
    };
  },
});

/** `dataset` key (→ `data-om-original-src`) holding an image's model `src`. */
export const ORIGINAL_SRC_DATASET = "omOriginalSrc";
