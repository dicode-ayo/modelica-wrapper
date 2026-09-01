import { vi } from "vitest";

/** Stand-in for the `omc-client` surface `registerMoFileWatcher` calls. */
export function makeWatcherClient() {
  return {
    parseFile: vi.fn(async () => ({ classNames: ["My.Pkg.Bar"] })),
    loadFile: vi.fn(async () => ({ success: true })),
    deleteClass: vi.fn(async () => ({ success: true })),
  };
}
