/**
 * The log seam. The extension routes this into its own output channel; a host
 * without one can drop the lines or print them.
 */
export interface McpLog {
  warn(message: string): void;
  info(message: string): void;
}

const SILENT: McpLog = {
  warn: () => undefined,
  info: () => undefined,
};

export function logOr(log: McpLog | undefined): McpLog {
  return log ?? SILENT;
}
