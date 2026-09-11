/**
 * The log seam. The extension routes this into its own output channel; a host
 * without one supplies a sink that drops the lines.
 */
export interface McpLog {
  warn(message: string): void;
  info(message: string): void;
}
