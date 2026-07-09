/**
 * The subset of the VSCode webview API the browser entries use, plus a lazy
 * cached accessor. `M` is the outbound message union for the specific webview.
 * Shared by every entry (diagram, postprocessing, library sidebar) so the
 * boilerplate lives in one place.
 */

export interface VsCodeApi<M> {
  postMessage(msg: M): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi<M>(): VsCodeApi<M>;

// `acquireVsCodeApi()` can only be called once per webview, so cache the handle
// in module scope. Read at first use (not module load) so a test bundle that
// imports an entry without an `acquireVsCodeApi` shim doesn't crash on parse.
let cachedApi: unknown = null;

export function getVsCodeApi<M>(): VsCodeApi<M> {
  cachedApi ??= acquireVsCodeApi<M>();
  return cachedApi as VsCodeApi<M>;
}
