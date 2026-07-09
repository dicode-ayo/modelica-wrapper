/**
 * Webview-side bridge that adapts diagram-ui's `LibraryDataSource`
 * (plain promises) onto the extension host's async postMessage protocol,
 * for the library sidebar view (`library-view-entry.ts`).
 *
 * Each `listChildren` / `searchAll` / `iconSvg` call mints a `requestId`, posts
 * the matching request, and parks the resolve/reject pair. The webview root
 * forwards every response message in via `handleResponse` / `handleIconResponse`,
 * which drains the matching entry. Requests stay pending until a response
 * arrives — the host always replies (success or `{ error }`), so a stuck
 * request implies a host bug worth seeing in the console.
 */

import type { LibraryDataSource, LibraryClassInfo } from "@dicode/diagram-ui";

import type {
  LibraryIconResponse,
  LibraryItemsResponse,
  LibraryRequestMessage,
} from "./library-messages.js";

export type {
  LibraryIconResponse,
  LibraryItemsResponse,
  LibraryRequestMessage,
};

/** Monotonic across instances so request ids can't collide if two sources ever
 *  coexist (a response then can't cross-match another instance's pending map). */
let instanceCount = 0;

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error("search superseded");
}

export class WebviewLibraryDataSource implements LibraryDataSource {
  private readonly idPrefix = `lib${(instanceCount += 1)}`;
  private nextId = 0;
  private readonly pending = new Map<
    string,
    {
      resolve: (items: LibraryClassInfo[]) => void;
      reject: (err: Error) => void;
    }
  >();
  // Icon requests resolve to an SVG string (or undefined for "no icon"), so
  // they get their own correlation map keyed on the same id space.
  private readonly pendingIcons = new Map<
    string,
    {
      resolve: (svg: string | undefined) => void;
      reject: (err: Error) => void;
    }
  >();

  constructor(private readonly post: (msg: LibraryRequestMessage) => void) {}

  listChildren(parent: string | null): Promise<LibraryClassInfo[]> {
    return new Promise((resolve, reject) => {
      const requestId = this.mintId();
      this.pending.set(requestId, { resolve, reject });
      this.post({ type: "libraryListChildren", requestId, parent });
    });
  }

  searchAll(query: string, signal?: AbortSignal): Promise<LibraryClassInfo[]> {
    return new Promise((resolve, reject) => {
      const requestId = this.mintId();
      if (signal?.aborted) {
        reject(abortError(signal));
        return;
      }
      this.pending.set(requestId, { resolve, reject });
      this.post({ type: "librarySearch", requestId, query });
      signal?.addEventListener(
        "abort",
        () => {
          // Settle here rather than waiting for a reply: the host drops the
          // request, so no `librarySearchResult` is coming for this id.
          if (this.pending.delete(requestId)) {
            this.post({ type: "libraryCancel", requestId });
            reject(abortError(signal));
          }
        },
        { once: true },
      );
    });
  }

  iconSvg(className: string): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const requestId = this.mintId();
      this.pendingIcons.set(requestId, { resolve, reject });
      this.post({ type: "libraryIcon", requestId, className });
    });
  }

  handleResponse(message: LibraryItemsResponse): void {
    const entry = this.pending.get(message.requestId);
    if (!entry) return;
    this.pending.delete(message.requestId);
    if (message.error !== undefined) {
      entry.reject(new Error(message.error));
      return;
    }
    entry.resolve(message.items ?? []);
  }

  handleIconResponse(message: LibraryIconResponse): void {
    const entry = this.pendingIcons.get(message.requestId);
    if (!entry) return;
    this.pendingIcons.delete(message.requestId);
    if (message.error !== undefined) {
      entry.reject(new Error(message.error));
      return;
    }
    entry.resolve(message.svg);
  }

  private mintId(): string {
    this.nextId += 1;
    return `${this.idPrefix}-${this.nextId}`;
  }
}
