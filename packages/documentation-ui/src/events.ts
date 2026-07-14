/**
 * DOM `CustomEvent`s `<om-documentation-editor>` emits. The event bubbles + is
 * composed so a host bridge can catch it at the boundary and forward it (e.g. a
 * VSCode `postMessage`, or an HTTP save in a web client). The component itself
 * never touches any host API — it's a pure renderer, like `diagram-ui` and
 * `result-ui`.
 */

/** Emitted (debounced) when the user changes the documentation. */
export interface DocumentationChangeDetail {
  /** The full canonical `info` HTML, `<html>` wrapper reattached. */
  info: string;
}

/**
 * Emitted when the user asks to edit the raw HTML in the host's own editor (in
 * VSCode, a native HTML text editor). A pure web host may leave this unhandled
 * and not set `source-editable`.
 */
export type DocumentationEditSourceDetail = Record<string, never>;

/** Emitted when the user follows a `modelica://` link (the host resolves it). */
export interface DocumentationOpenLinkDetail {
  /** The `modelica://…` href — a class cross-reference or a resource path. */
  href: string;
}

declare global {
  interface HTMLElementEventMap {
    "om-documentation-change": CustomEvent<DocumentationChangeDetail>;
    "om-documentation-edit-source": CustomEvent<DocumentationEditSourceDetail>;
    "om-documentation-open-link": CustomEvent<DocumentationOpenLinkDetail>;
  }
}
