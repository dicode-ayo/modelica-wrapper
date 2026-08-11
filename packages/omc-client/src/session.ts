/**
 * Naming of a per-spawn OMC session directory and of the port file OMC drops
 * inside it. The spawner writes these names and the reaper reads them back, so
 * both sides have to agree on every segment.
 *
 * The owner's pid is part of the directory name rather than a file written
 * into it: a directory exists from the instant it is created, so there is no
 * window in which a concurrent reap can see an unclaimed session.
 */

/** Prefix of the per-spawn tempdir handed to OMC as its `TMPDIR`. */
export const SESSION_DIR_PREFIX = "mw-omc-";

/** Pid of the OMC process itself, written inside its session tempdir. */
export const OMC_PID_FILE = "omc.pid";

/**
 * Sentinel `USER` value passed to OMC. The actual login user is irrelevant —
 * OMC only uses this string as a path segment in the port-file name.
 */
export const WRAPPER_USER = "mw";

/** `mkdtemp` prefix that stamps the spawning process into the directory name. */
export function sessionDirPrefix(ownerPid: number): string {
  return `${SESSION_DIR_PREFIX}${ownerPid}-`;
}

/** The pid stamped into a session directory name, if it carries one. */
export function ownerPidFromSessionDir(name: string): number | undefined {
  const stamp = /^(\d+)-/.exec(name.slice(SESSION_DIR_PREFIX.length))?.[1];
  if (stamp === undefined) return undefined;
  const pid = Number.parseInt(stamp, 10);
  return pid > 0 ? pid : undefined;
}

/**
 * OMC builds its port-file path as `${TMPDIR}/openmodelica.${USER}.port.${suffix}`.
 * Windows drops the user segment unconditionally (compile-time branch in
 * `zeromqimpl.c`), Unix keeps it.
 */
export function portFileName(suffix: string): string {
  return process.platform === "win32"
    ? `openmodelica.port.${suffix}`
    : `openmodelica.${WRAPPER_USER}.port.${suffix}`;
}

export function isPortFileName(name: string): boolean {
  return name.startsWith("openmodelica.") && name.includes(".port.");
}

/** The `-z=` suffix OMC was spawned with, recovered from its port-file name. */
export function suffixFromPortFileName(name: string): string | undefined {
  const marker = ".port.";
  const start = name.indexOf(marker);
  if (start < 0) return undefined;
  const suffix = name.slice(start + marker.length);
  return suffix.length > 0 ? suffix : undefined;
}
