import * as path from "node:path";

export interface EventScheduler {
  run(key: string, describedPath: string, fn: () => Promise<void>): void;
}

export interface EventSchedulerDeps {
  ready: () => Promise<void>;
  onError: (describedPath: string, err: unknown) => void;
}

interface Entry {
  readonly key: string;
  readonly settled: Promise<void>;
}

function isPackageFile(key: string): boolean {
  return path.basename(key) === "package.mo";
}

function dirContains(dir: string, target: string): boolean {
  const rel = path.relative(dir, target);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  );
}

/**
 * A `package.mo` key subsumes every key at or below its directory, because
 * its handlers (cascaded delete, reorder) touch the whole subtree.
 */
function conflicts(a: string, b: string): boolean {
  if (a === b) return true;
  if (isPackageFile(a) && dirContains(path.dirname(a), path.dirname(b))) {
    return true;
  }
  return isPackageFile(b) && dirContains(path.dirname(b), path.dirname(a));
}

/**
 * Orders watcher events that touch overlapping state. Each event waits for
 * `ready()` and for every earlier in-flight event whose key conflicts with
 * its own; non-conflicting events run concurrently.
 *
 * `key` and `describedPath` differ when an event is queued under its owning
 * package's path; the failure report names the file that triggered it.
 */
export function createEventScheduler(deps: EventSchedulerDeps): EventScheduler {
  const inFlight = new Set<Entry>();

  return {
    run(key, describedPath, fn) {
      const resolvedKey = path.resolve(key);
      const blockers = [...inFlight]
        .filter((entry) => conflicts(entry.key, resolvedKey))
        .map((entry) => entry.settled);
      const settled: Promise<void> = Promise.all(blockers)
        .then(() => deps.ready())
        .then(fn)
        .catch((err: unknown) => {
          try {
            deps.onError(describedPath, err);
          } catch {
            // A throwing reporter must not leave `settled` rejected, which would
            // strand every conflicting later event.
          }
        });
      const entry: Entry = { key: resolvedKey, settled };
      inFlight.add(entry);
      void settled.then(() => {
        inFlight.delete(entry);
      });
    },
  };
}
