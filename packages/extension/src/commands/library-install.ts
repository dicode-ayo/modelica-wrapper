/**
 * Load a library from MODELICAPATH, offering to install it from OMC's package
 * index when it is missing there but the index has it.
 */

export interface LibraryInstallClient {
  loadModel(input: { typeName: string }): Promise<{ success: boolean }>;
  getErrorString(): Promise<{ errorString: string }>;
  getAvailablePackageVersions(input: {
    typeName: string;
    version: string;
  }): Promise<{ withoutConversion: string[] }>;
  updatePackageIndex(): Promise<{ result: boolean }>;
  installPackage(input: {
    typeName: string;
    version: string;
    exactMatch: boolean;
  }): Promise<{ result: boolean }>;
}

export interface LibraryInstallUi {
  /** Resolve `true` only when the user chose to install. */
  confirmInstall(name: string, version: string): Promise<boolean>;
  withProgress<T>(title: string, task: () => Promise<T>): PromiseLike<T>;
}

export type LoadLibraryResult =
  | { kind: "loaded" }
  | { kind: "installed"; version: string }
  /** `loadError` is OMC's message from the failed `loadModel`. */
  | { kind: "loadFailed"; loadError: string }
  | { kind: "declined"; loadError: string }
  | { kind: "indexUpdateFailed"; loadError: string; error: string }
  | { kind: "installFailed"; version: string; error: string }
  | { kind: "reloadFailed"; version: string; error: string }
  | { kind: "busy" };

export type LoadLibrary = (
  client: LibraryInstallClient,
  name: string,
) => Promise<LoadLibraryResult>;

/** The version with any semver build metadata (`+maint.om`) dropped. */
export function displayVersion(version: string): string {
  const plus = version.indexOf("+");
  return plus === -1 ? version : version.slice(0, plus);
}

/**
 * A loader that refuses a second run for a name whose previous run is still in
 * flight, so one library is never installed twice concurrently.
 */
export function createLibraryLoader(ui: LibraryInstallUi): LoadLibrary {
  const inFlight = new Set<string>();
  return async (client, name) => {
    if (inFlight.has(name)) return { kind: "busy" };
    inFlight.add(name);
    try {
      return await loadOrInstall(client, name, ui);
    } finally {
      inFlight.delete(name);
    }
  };
}

async function loadOrInstall(
  client: LibraryInstallClient,
  name: string,
  ui: LibraryInstallUi,
): Promise<LoadLibraryResult> {
  const { success } = await client.loadModel({ typeName: name });
  if (success) return { kind: "loaded" };
  const { errorString: loadError } = await client.getErrorString();

  let versions = await availableVersions(client, name);
  if (versions.length === 0) {
    // An empty answer is indistinguishable from a missing index, so refresh
    // once. A failed refresh (e.g. a broken CA path) is reported as such
    // rather than read as "not in the index".
    const { result } = await ui.withProgress(
      "Modelica: Updating the package index…",
      () => client.updatePackageIndex(),
    );
    if (!result) {
      const { errorString } = await client.getErrorString();
      return { kind: "indexUpdateFailed", loadError, error: errorString };
    }
    versions = await availableVersions(client, name);
  }
  // OMC orders the list by preference.
  const [version] = versions;
  if (version === undefined) return { kind: "loadFailed", loadError };

  if (!(await ui.confirmInstall(name, version))) {
    return { kind: "declined", loadError };
  }

  return ui.withProgress(
    `Modelica: Installing ${name} ${displayVersion(version)}…`,
    async (): Promise<LoadLibraryResult> => {
      const installed = await client.installPackage({
        typeName: name,
        version,
        exactMatch: true,
      });
      if (!installed.result) {
        const { errorString } = await client.getErrorString();
        return { kind: "installFailed", version, error: errorString };
      }
      const reloaded = await client.loadModel({ typeName: name });
      if (!reloaded.success) {
        const { errorString } = await client.getErrorString();
        return { kind: "reloadFailed", version, error: errorString };
      }
      return { kind: "installed", version };
    },
  );
}

async function availableVersions(
  client: LibraryInstallClient,
  name: string,
): Promise<string[]> {
  const { withoutConversion } = await client.getAvailablePackageVersions({
    typeName: name,
    version: "",
  });
  return withoutConversion;
}
