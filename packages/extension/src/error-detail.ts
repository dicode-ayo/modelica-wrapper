/** The message of a caught `unknown`, without assuming it's an `Error`. */
export function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
