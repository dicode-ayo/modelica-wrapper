/**
 * The ready-gate buffers host→webview seeds until the webview reports `ready`.
 * These pin the buffer-then-flush contract both the diagram panel and the
 * diagram custom editor depend on.
 */

import { describe, expect, it } from "vitest";

import type { ExtensionToWebview } from "./protocol.js";
import { createReadyGate } from "./ready-gate.js";

function fakeWebview(): {
  webview: Parameters<typeof createReadyGate>[0];
  posted: ExtensionToWebview[];
} {
  const posted: ExtensionToWebview[] = [];
  const webview = {
    postMessage: (m: ExtensionToWebview) => {
      posted.push(m);
      return Promise.resolve(true);
    },
  } as unknown as Parameters<typeof createReadyGate>[0];
  return { webview, posted };
}

const A: ExtensionToWebview = { type: "parametersClose" };
const B: ExtensionToWebview = { type: "placementCancel" };

describe("createReadyGate", () => {
  it("buffers sends until markReady, then flushes them in order", () => {
    const { webview, posted } = fakeWebview();
    const gate = createReadyGate(webview);

    gate.send(A);
    gate.send(B);
    expect(posted).toEqual([]);

    gate.markReady();
    expect(posted).toEqual([A, B]);
  });

  it("posts directly once ready", () => {
    const { webview, posted } = fakeWebview();
    const gate = createReadyGate(webview);
    gate.markReady();

    gate.send(A);
    expect(posted).toEqual([A]);
  });

  it("markReady is idempotent — a second signal does not re-flush", () => {
    const { webview, posted } = fakeWebview();
    const gate = createReadyGate(webview);
    gate.send(A);
    gate.markReady();
    gate.markReady();
    expect(posted).toEqual([A]);
  });
});
