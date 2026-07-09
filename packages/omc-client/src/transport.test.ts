/**
 * A timed-out call leaves its request on the wire. These pin that the socket
 * never carries a second request past an unanswered one — the REQ/REP
 * violation that wedges the channel for every later call.
 */

import { describe, expect, it } from "vitest";

import { OmcTransport, type OmcSocket } from "./transport.js";

/** Enforces REQ's send→receive alternation, so a desync throws instead of hanging. */
class FakeSocket implements OmcSocket {
  linger = 0;
  closed = false;
  /** Replies to hand out, in order. `null` never resolves (a hung call). */
  constructor(private readonly replies: Array<string | null>) {}

  private awaitingReply = false;
  private sent = 0;

  connect(): void {}

  send(): Promise<void> {
    if (this.closed) return Promise.reject(new Error("socket closed"));
    if (this.awaitingReply) {
      return Promise.reject(
        new Error("Socket is busy writing; only one send may be in progress"),
      );
    }
    this.awaitingReply = true;
    this.sent++;
    return Promise.resolve();
  }

  receive(): Promise<Buffer[]> {
    const reply = this.replies[this.sent - 1];
    if (reply === null || reply === undefined) {
      // Never resolves, and never rejects on close either — a receive that
      // outlives its socket is exactly what the timeout path must tolerate.
      return new Promise<Buffer[]>(() => undefined);
    }
    this.awaitingReply = false;
    return Promise.resolve([Buffer.from(reply, "utf8")]);
  }

  close(): void {
    this.closed = true;
  }
}

describe("OmcTransport timeout handling", () => {
  it("keeps the channel usable after a call times out", async () => {
    const sockets: FakeSocket[] = [];
    // First socket hangs on its only request; the redialed one answers.
    const scripts: Array<Array<string | null>> = [[null], ["1.26.7"]];
    const transport = new OmcTransport("tcp://127.0.0.1:1", () => {
      const sock = new FakeSocket(scripts[sockets.length] ?? []);
      sockets.push(sock);
      return sock;
    });
    await transport.dial();

    await expect(transport.send("getVersion()", 10)).rejects.toThrow(
      /timed out after 10ms/,
    );

    await expect(transport.send("getVersion()", 1_000)).resolves.toBe("1.26.7");
    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.closed).toBe(true);
  });

  it("does not reuse the socket that still owes a reply", async () => {
    const sockets: FakeSocket[] = [];
    const transport = new OmcTransport("tcp://127.0.0.1:1", () => {
      // Every socket hangs, so a reused one would reject with the REQ error
      // rather than time out again.
      const sock = new FakeSocket([null]);
      sockets.push(sock);
      return sock;
    });
    await transport.dial();

    await expect(transport.send("getVersion()", 10)).rejects.toThrow(
      /timed out/,
    );
    await expect(transport.send("getVersion()", 10)).rejects.toThrow(
      /timed out/,
    );

    expect(sockets).toHaveLength(3);
  });

  it("leaves the socket in place when a call succeeds", async () => {
    const sockets: FakeSocket[] = [];
    const transport = new OmcTransport("tcp://127.0.0.1:1", () => {
      const sock = new FakeSocket(["a", "b"]);
      sockets.push(sock);
      return sock;
    });
    await transport.dial();

    await expect(transport.send("getVersion()", 1_000)).resolves.toBe("a");
    await expect(transport.send("getVersion()", 1_000)).resolves.toBe("b");
    expect(sockets).toHaveLength(1);
  });
});
