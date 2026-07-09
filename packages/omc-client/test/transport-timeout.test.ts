/**
 * Timeout recovery against a real zeromq REQ socket.
 *
 * A REQ socket with no peer goes mute: `send()` never completes, so the
 * timeout fires while the send is still pending. Reusing that socket makes the
 * next `send()` overlap the first, which zeromq rejects with "Socket is busy
 * writing" — and every later call with it. No OMC process is needed; the
 * absence of a peer is the point.
 */

import { describe, expect, it } from "vitest";

import { OmcTransport } from "../src/transport.js";

/** Unroutable port on loopback, so the REQ socket never finds a peer. */
const DEAD_ENDPOINT = "tcp://127.0.0.1:59997";

describe("OmcTransport against a mute peer", () => {
  it("reports every call as a timeout, never as a desynced socket", async () => {
    const transport = new OmcTransport(DEAD_ENDPOINT);
    await transport.dial();
    try {
      for (let i = 0; i < 4; i++) {
        await expect(transport.send("getVersion()", 25)).rejects.toThrow(
          /timed out after 25ms: getVersion\(\)/,
        );
      }
    } finally {
      await transport.close();
    }
  }, 30_000);
});
