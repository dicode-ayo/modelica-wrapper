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

declare global {
  interface HTMLElementEventMap {
    "om-documentation-change": CustomEvent<DocumentationChangeDetail>;
  }
}
