/**
 * Stand-in for the webview's `acquireVsCodeApi` global, which only the VSCode
 * webview iframe defines. `getVsCodeApi` caches the first handle per module
 * graph, so a test file installs this once, before any entry element mounts.
 */

export interface RecordingVsCodeApi<M> {
  readonly posted: M[];
}

export function installVsCodeApi<M>(): RecordingVsCodeApi<M> {
  const posted: M[] = [];
  let state: unknown;
  Object.assign(globalThis, {
    acquireVsCodeApi: () => ({
      postMessage: (msg: M) => posted.push(msg),
      getState: () => state,
      setState: (next: unknown) => {
        state = next;
      },
    }),
  });
  return { posted };
}

/** Delivers `data` the way the host's `webview.postMessage` arrives. */
export function postFromHost(data: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data }));
}
