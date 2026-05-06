/**
 * ZeroMQ REQ socket transport to OMC's REP socket.
 *
 * OMC uses strict REQ/REP semantics: every send must be followed by a receive
 * before the next send. The OmcClient layer enforces serialization with a
 * promise-chain mutex.
 */

import { Request } from "zeromq";

import type { OmcCommand } from "./commands.js";

export class OmcTransport {
  private socket: Request | undefined;

  constructor(private readonly endpoint: string) {}

  async dial(): Promise<void> {
    const sock = new Request();
    // OMC closes its REP socket on quit(); without a short linger, our
    // process can hang on shutdown waiting for unsent messages to drain.
    sock.linger = 200;
    sock.connect(this.endpoint);
    this.socket = sock;
  }

  /**
   * Send one Modelica command string and await OMC's response.
   *
   * @param cmd raw OMC RPC command, e.g. `getVersion()`.
   * @param timeoutMs cap on the round-trip; 0 disables.
   */
  async send(cmd: OmcCommand, timeoutMs: number): Promise<string> {
    if (!this.socket) throw new Error("transport not connected");
    const sock = this.socket;

    const op = (async () => {
      await sock.send(cmd);
      const [reply] = await sock.receive();
      if (!reply) throw new Error("empty reply from omc");
      return reply.toString("utf8");
    })();

    if (timeoutMs <= 0) return op;

    let timer: NodeJS.Timeout | undefined;
    const timeoutErr = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`omc call timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    try {
      return await Promise.race([op, timeoutErr]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    if (!this.socket) return;
    const sock = this.socket;
    this.socket = undefined;
    sock.close();
  }
}
