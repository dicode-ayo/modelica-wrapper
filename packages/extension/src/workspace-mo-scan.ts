/**
 * Memoizes a single recursive `.mo` file scan so two independent
 * `sessionReplaced` listeners (the mo-file-watcher's index reseed and
 * workspace-autoload's `:reset` entry-point derivation) can share one disk
 * walk instead of each running their own.
 */

export interface MoFileScanner {
  /** Runs `findFiles` at most once per {@link MoFileScanner.invalidate} call, caching the result. */
  scan(): Promise<readonly string[]>;
  /** Drops the memo so the next {@link MoFileScanner.scan} hits disk again. */
  invalidate(): void;
}

export function createMoFileScanner(
  findFiles: () => Promise<readonly string[]>,
): MoFileScanner {
  let pending: Promise<readonly string[]> | undefined;

  return {
    scan(): Promise<readonly string[]> {
      if (pending === undefined) {
        // A rejected scan clears its own memo so the next scan() retries
        // instead of caching the failure forever.
        pending = findFiles().catch((err: unknown) => {
          pending = undefined;
          throw err;
        });
      }
      return pending;
    },
    invalidate(): void {
      pending = undefined;
    },
  };
}
