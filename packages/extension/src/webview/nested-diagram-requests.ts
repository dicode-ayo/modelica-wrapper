/**
 * Webview-side correlation for `nestedDiagramRequest` / `nestedDiagramResult`
 * — the semantic in-place nesting zoom feature's fetch of a component's own
 * class diagram (issue #629), the diagram protocol's first departure from
 * fire-and-forget. Mirrors `WebviewLibraryDataSource`'s id-minting +
 * pending-map pattern (`library-data-source.ts`).
 */

import type { DiagramLayout } from "@dicode/omc-client";

import type { ExtensionToWebview, WebviewToExtension } from "./protocol.js";

type NestedDiagramResult = Extract<
  ExtensionToWebview,
  { type: "nestedDiagramResult" }
>;

export class NestedDiagramRequests {
  private nextId = 0;
  private readonly pending = new Map<
    string,
    { resolve: (layout: DiagramLayout) => void; reject: (err: Error) => void }
  >();

  constructor(private readonly post: (msg: WebviewToExtension) => void) {}

  /**
   * Request `className`'s own diagram layout — fetched with that class as
   * its own root, cached class-wide by the host. Resolves to the fetched
   * layout, or rejects with the host's reported error.
   */
  request(className: string): Promise<DiagramLayout> {
    return new Promise((resolve, reject) => {
      const requestId = `nested-${(this.nextId += 1)}`;
      this.pending.set(requestId, { resolve, reject });
      this.post({ type: "nestedDiagramRequest", requestId, className });
    });
  }

  /** Drain the pending entry a `nestedDiagramResult` answers. */
  handleResult(message: NestedDiagramResult): void {
    const entry = this.pending.get(message.requestId);
    if (!entry) return;
    this.pending.delete(message.requestId);
    if (message.error !== undefined) {
      entry.reject(new Error(message.error));
      return;
    }
    if (message.layout === undefined) {
      entry.reject(
        new Error(
          `nestedDiagramResult for ${message.className} carried neither a layout nor an error`,
        ),
      );
      return;
    }
    entry.resolve(message.layout);
  }
}
