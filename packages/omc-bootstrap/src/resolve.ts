/**
 * Which OpenModelica the extension uses, and which of the three it is.
 *
 * `omc-client` knows how to use an environment; this package knows how to make
 * one. Resolution is the half that has to work before any install exists.
 *
 * Precedence: an explicit `modelica.omcPath` wins, then a managed
 * installation, then `PATH`. The setting is never probed — a stated choice
 * that turns out to be broken has to fail as itself rather than resolve to
 * something the user did not name.
 *
 * Nothing here reads the ambient platform. Windows resolves against `omc.exe`
 * and a semicolon-separated `PATH` and is the one platform with no managed
 * install to find, so it has to be reachable from a test on any host.
 */

import * as path from "node:path";

/** Does a path exist? Injectable so tests answer from a fixed set. */
export type FileProbe = (absolutePath: string) => Promise<boolean>;

/** Which of the three OpenModelicas a resolution found. */
export type OmcSource = "setting" | "managed" | "path";

/**
 * The resolved `omc` and where it came from. The source is reported rather
 * than left to be deduced because the status bar names it: nothing in the
 * settings file says which OpenModelica is in use.
 */
export type OmcResolution =
  | { readonly source: OmcSource; readonly omcPath: string }
  | { readonly source: "missing"; readonly omcPath?: undefined };

export interface ResolveOmcInput {
  /** `modelica.omcPath` as a human typed it; blank when unset. */
  readonly setting: string;
  /** The directory this extension owns, from {@link managedRoot}. */
  readonly managedRoot: string;
  /** `PATH` of the process that will do the spawning. */
  readonly pathVariable: string;
  readonly platform: NodeJS.Platform;
}

/**
 * The directory this extension exclusively owns, inside the one OpenModelica
 * already owns. Exclusive ownership is what makes "only ever remove a prefix
 * we created" a guarantee rather than a hope.
 */
export function managedRoot(
  homeDir: string,
  platform: NodeJS.Platform,
): string {
  return platformPath(platform).join(
    homeDir,
    ".openmodelica",
    "modelica-wrapper",
  );
}

const MANAGED_PREFIX = "current";

/**
 * The `omc` of a managed installation. An install stages elsewhere under the
 * root and moves here only once it has verified, so a binary at this path is
 * by definition one that ran.
 */
export function managedOmcBinary(
  root: string,
  platform: NodeJS.Platform,
): string {
  return platformPath(platform).join(
    root,
    MANAGED_PREFIX,
    "bin",
    binaryName(platform),
  );
}

export async function resolveOmc(
  input: ResolveOmcInput,
  probe: FileProbe,
): Promise<OmcResolution> {
  const setting = input.setting.trim();
  if (setting.length > 0) return { source: "setting", omcPath: setting };

  const managed = managedOmcBinary(input.managedRoot, input.platform);
  if (await probe(managed)) return { source: "managed", omcPath: managed };

  const onPath = await searchPath(input.pathVariable, input.platform, probe);
  if (onPath !== undefined) return { source: "path", omcPath: onPath };

  return { source: "missing" };
}

function platformPath(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

function binaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "omc.exe" : "omc";
}

/** The first `omc` in `PATH` order, which is the one a spawn would reach. */
async function searchPath(
  pathVariable: string,
  platform: NodeJS.Platform,
  probe: FileProbe,
): Promise<string | undefined> {
  const paths = platformPath(platform);
  const name = binaryName(platform);
  for (const directory of pathVariable.split(paths.delimiter)) {
    // An empty or relative entry resolves against the working directory, which
    // makes it neither a location the user pointed at nor one this probe's
    // contract admits.
    if (!paths.isAbsolute(directory)) continue;
    const candidate = paths.join(directory, name);
    if (await probe(candidate)) return candidate;
  }
  return undefined;
}
