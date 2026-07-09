/**
 * ZeroMQ REQ socket transport to OMC's REP socket.
 *
 * OMC uses strict REQ/REP semantics: every send must be followed by a receive
 * before the next send. `OmcClient` serializes calls so only one round-trip is
 * ever in flight.
 *
 * A timed-out call has already put its request on the wire, and OMC will
 * eventually reply into a socket nobody is reading. Reusing that socket would
 * pair every later request with the previous request's reply. The socket is
 * discarded and redialed before the timeout is reported, trading one lost
 * reply for a channel that still works.
 */

import { Request } from "zeromq";

import type { OmcCommand } from "./commands.js";

const TIMED_OUT = Symbol("omc call timed out");

/** Commands carrying a whole class source (`loadString`) would swamp the log. */
const MAX_LOGGED_COMMAND = 200;

function abbreviate(cmd: string): string {
  return cmd.length <= MAX_LOGGED_COMMAND
    ? cmd
    : `${cmd.slice(0, MAX_LOGGED_COMMAND)}… (${cmd.length} chars)`;
}

/** The slice of a zeromq `Request` socket this transport drives. */
export interface OmcSocket {
  linger: number;
  connect(endpoint: string): void;
  send(cmd: string): Promise<void>;
  receive(): Promise<Buffer[]>;
  close(): void;
}

export type SocketFactory = () => OmcSocket;

export class OmcTransport {
  private socket: OmcSocket | undefined;

  constructor(
    private readonly endpoint: string,
    private readonly createSocket: SocketFactory = () => new Request(),
  ) {}

  async dial(): Promise<void> {
    const sock = this.createSocket();
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
    const sock = this.socket;
    if (!sock) throw new Error("transport not connected");

    const op = (async () => {
      await sock.send(cmd);
      const [reply] = await sock.receive();
      if (!reply) throw new Error("empty reply from omc");
      return reply.toString("utf8");
    })();

    if (timeoutMs <= 0) return op;

    let timer: NodeJS.Timeout | undefined;
    const expiry = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    });

    let outcome: string | typeof TIMED_OUT;
    try {
      outcome = await Promise.race([op, expiry]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (outcome !== TIMED_OUT) return outcome;

    // The abandoned receive rejects once the socket closes; nobody awaits it.
    op.catch(() => undefined);
    await this.reset();
    throw new Error(
      `omc call timed out after ${timeoutMs}ms: ${abbreviate(cmd)}`,
    );
  }

  /** Discard the desynced socket and dial a fresh one. */
  private async reset(): Promise<void> {
    const stale = this.socket;
    this.socket = undefined;
    stale?.close();
    await this.dial();
  }

  async close(): Promise<void> {
    if (!this.socket) return;
    const sock = this.socket;
    this.socket = undefined;
    sock.close();
  }
}
