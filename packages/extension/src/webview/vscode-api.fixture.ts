import { ReactiveElement } from "lit";
import { afterEach, vi } from "vitest";

/**
 * Stand-in for the webview's `acquireVsCodeApi` global, which only the VSCode
 * webview iframe defines. `getVsCodeApi` caches the first handle per module
 * graph, so a test file installs this once, before any entry element mounts.
 */
export interface RecordingVsCodeApi<Out, In> {
  readonly posted: Out[];
  /** Forgets what was posted so far, e.g. the `ready` a mount sends. */
  clear(): void;
  /** Delivers a host message and waits for the re-render it causes. */
  fromHost(root: ReactiveElement, msg: In): Promise<void>;
}

/**
 * Also registers the per-test cleanup every entry test shares: unmounts what
 * the test connected, forgets its posts and state, and restores its spies.
 */
export function installVsCodeApi<Out, In>(): RecordingVsCodeApi<Out, In> {
  const posted: Out[] = [];
  let state: unknown;
  Object.assign(globalThis, {
    acquireVsCodeApi: () => ({
      postMessage: (msg: Out) => posted.push(msg),
      getState: () => state,
      setState: (next: unknown) => {
        state = next;
      },
    }),
  });
  const clear = () => {
    posted.length = 0;
  };
  afterEach(() => {
    document.body.replaceChildren();
    clear();
    state = undefined;
    vi.restoreAllMocks();
  });
  return {
    posted,
    clear,
    fromHost: async (root, msg) => {
      postFromHost(msg);
      await root.updateComplete;
    },
  };
}

/** Connects a fresh `<tag>` to the document and waits for its first render. */
export async function mountRoot<K extends keyof HTMLElementTagNameMap>(
  tag: K,
): Promise<HTMLElementTagNameMap[K]> {
  const root = document.createElement(tag);
  document.body.append(root);
  if (!(root instanceof ReactiveElement)) {
    throw new Error(`<${tag}> is not a registered Lit element`);
  }
  await root.updateComplete;
  return root;
}

/** Delivers unchecked `data` the way the host's `webview.postMessage` arrives. */
export function postFromHost(data: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

export function rendered<K extends keyof HTMLElementTagNameMap>(
  scope: ParentNode | null | undefined,
  tag: K,
): HTMLElementTagNameMap[K] {
  const el = scope?.querySelector(tag);
  if (!el) throw new Error(`expected <${tag}> in the rendered tree`);
  return el;
}
