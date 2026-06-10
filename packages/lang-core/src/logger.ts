/** Minimal sink for hot-path diagnostic traces; the host supplies a real one. */
export interface Logger {
  debug(topic: string, message: string, data?: unknown): void;
}

export const noopLogger: Logger = { debug() {} };
