/**
 * Memoizes a single recursive `.mo` file scan so two independent
 * `sessionReplaced` listeners (the mo-file-watcher's index reseed and
 * workspace-autoload's `:reset` entry-point derivation) can share one disk
 * walk instead of each running their own. No vscode dependency — `findFiles`
 * is injected, so this is unit-testable with a plain counting stub.
 */

export interface MoFileScanner {
  /** Runs `findFiles` at most once per {@link MoFileScanner.invalidate} call, caching the result. */
  scan(): Promise<readonly string[]>;
}

export function createMoFileScanner(
  findFiles: () => Promise<readonly string[]>,
): MoFileScanner & { invalidate(): void } {
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
