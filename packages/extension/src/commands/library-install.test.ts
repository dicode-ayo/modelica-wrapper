/**
 * The load-or-install sequence behind `modelica.loadLibrary`: when an offer is
 * made, what has to happen before it, and what must never happen after a
 * refusal or a failure.
 */

import { describe, expect, it } from "vitest";

import {
  createLibraryLoader,
  displayVersion,
  type LibraryInstallClient,
  type LibraryInstallUi,
} from "./library-install.js";

const LOAD_ERROR =
  "Error: Failed to load package Modelica (default) using MODELICAPATH ~/.openmodelica/libraries/.";

interface FakeOptions {
  /** Successive `loadModel` answers; the last repeats. */
  loads?: boolean[];
  /** Successive `getAvailablePackageVersions` answers; the last repeats. */
  versions?: string[][];
  indexUpdate?: boolean;
  install?: () => Promise<boolean>;
  /** Successive `getErrorString` answers; the last repeats. */
  errors?: string[];
}

function fakeClient(opts: FakeOptions = {}): {
  client: LibraryInstallClient;
  calls: string[];
} {
  const calls: string[] = [];
  const take = <T>(queue: T[], fallback: T): T =>
    queue.length > 1 ? (queue.shift() ?? fallback) : (queue[0] ?? fallback);
  const loads = [...(opts.loads ?? [false, true])];
  const versions = [...(opts.versions ?? [["4.1.0+maint.om", "4.0.0"]])];
  const errors = [...(opts.errors ?? [LOAD_ERROR])];
  const client: LibraryInstallClient = {
    loadModel: ({ typeName }) => {
      calls.push(`loadModel ${typeName}`);
      return Promise.resolve({ success: take(loads, false) });
    },
    getErrorString: () => {
      calls.push("getErrorString");
      return Promise.resolve({ errorString: take(errors, "") });
    },
    getAvailablePackageVersions: ({ typeName }) => {
      calls.push(`getAvailablePackageVersions ${typeName}`);
      return Promise.resolve({ withoutConversion: take(versions, []) });
    },
    updatePackageIndex: () => {
      calls.push("updatePackageIndex");
      return Promise.resolve({ result: opts.indexUpdate ?? true });
    },
    installPackage: async ({ typeName, version, exactMatch }) => {
      calls.push(`installPackage ${typeName} ${version} ${String(exactMatch)}`);
      return { result: opts.install ? await opts.install() : true };
    },
  };
  return { client, calls };
}

function fakeUi(confirm = true): {
  ui: LibraryInstallUi;
  prompts: string[];
  progress: string[];
} {
  const prompts: string[] = [];
  const progress: string[] = [];
  return {
    prompts,
    progress,
    ui: {
      confirmInstall: (name, version) => {
        prompts.push(`${name} ${version}`);
        return Promise.resolve(confirm);
      },
      withProgress: (title, task) => {
        progress.push(title);
        return task();
      },
    },
  };
}

describe("createLibraryLoader", () => {
  it("does not touch the package index when the library loads", async () => {
    const { client, calls } = fakeClient({ loads: [true] });
    const { ui, prompts } = fakeUi();

    const result = await createLibraryLoader(ui)(client, "Modelica");

    expect(result).toEqual({ kind: "loaded" });
    expect(calls).toEqual(["loadModel Modelica"]);
    expect(prompts).toEqual([]);
  });

  it("offers the index's first version, installs it exactly, then reloads", async () => {
    const { client, calls } = fakeClient();
    const { ui, prompts, progress } = fakeUi();

    const result = await createLibraryLoader(ui)(client, "Modelica");

    expect(result).toEqual({ kind: "installed", version: "4.1.0+maint.om" });
    expect(prompts).toEqual(["Modelica 4.1.0+maint.om"]);
    expect(progress).toEqual(["Modelica: Installing Modelica 4.1.0…"]);
    expect(calls).toEqual([
      "loadModel Modelica",
      "getErrorString",
      "getAvailablePackageVersions Modelica",
      "installPackage Modelica 4.1.0+maint.om true",
      "loadModel Modelica",
    ]);
  });

  it("installs nothing and keeps the load error when the offer is declined", async () => {
    const { client, calls } = fakeClient();
    const { ui } = fakeUi(false);

    const result = await createLibraryLoader(ui)(client, "Modelica");

    expect(result).toEqual({ kind: "declined", loadError: LOAD_ERROR });
    expect(calls.some((c) => c.startsWith("installPackage"))).toBe(false);
  });

  it("refreshes an empty index once and offers what the refresh found", async () => {
    const { client, calls } = fakeClient({ versions: [[], ["4.1.0"]] });
    const { ui, prompts } = fakeUi();

    await createLibraryLoader(ui)(client, "Modelica");

    expect(prompts).toEqual(["Modelica 4.1.0"]);
    expect(calls.slice(0, 5)).toEqual([
      "loadModel Modelica",
      "getErrorString",
      "getAvailablePackageVersions Modelica",
      "updatePackageIndex",
      "getAvailablePackageVersions Modelica",
    ]);
  });

  it("reports a plain load failure without a prompt for a library the index lacks", async () => {
    const { client, calls } = fakeClient({ versions: [[]] });
    const { ui, prompts } = fakeUi();

    const result = await createLibraryLoader(ui)(client, "NoSuchLib");

    expect(result).toEqual({ kind: "loadFailed", loadError: LOAD_ERROR });
    expect(prompts).toEqual([]);
    expect(calls.filter((c) => c === "updatePackageIndex")).toHaveLength(1);
  });

  it("surfaces a failed index refresh instead of treating it as not in the index", async () => {
    const caError =
      "Error: curl: SSL certificate problem: unable to get local issuer certificate";
    const { client, calls } = fakeClient({
      versions: [[]],
      indexUpdate: false,
      errors: [LOAD_ERROR, caError],
    });
    const { ui, prompts } = fakeUi();

    const result = await createLibraryLoader(ui)(client, "Modelica");

    expect(result).toEqual({
      kind: "indexUpdateFailed",
      loadError: LOAD_ERROR,
      error: caError,
    });
    expect(prompts).toEqual([]);
    expect(
      calls.filter((c) => c.startsWith("getAvailablePackageVersions")),
    ).toHaveLength(1);
  });

  it("reports OMC's own error when the install fails, and does not reload", async () => {
    const diskError = "Error: Failed to write /home/u/.openmodelica/libraries/";
    const { client, calls } = fakeClient({
      install: () => Promise.resolve(false),
      errors: [LOAD_ERROR, diskError],
    });
    const { ui } = fakeUi();

    const result = await createLibraryLoader(ui)(client, "Modelica");

    expect(result).toEqual({
      kind: "installFailed",
      version: "4.1.0+maint.om",
      error: diskError,
    });
    expect(calls.filter((c) => c === "loadModel Modelica")).toHaveLength(1);
  });

  it("refuses a second run for the same library while the first is installing", async () => {
    let finishInstall: (ok: boolean) => void = () => {};
    const installGate = new Promise<boolean>((resolve) => {
      finishInstall = resolve;
    });
    const { client, calls } = fakeClient({ install: () => installGate });
    const { ui } = fakeUi();
    const load = createLibraryLoader(ui);

    const first = load(client, "Modelica");
    await flushUntil(() => calls.some((c) => c.startsWith("installPackage")));
    const second = await load(client, "Modelica");
    finishInstall(true);

    expect(second).toEqual({ kind: "busy" });
    expect(await first).toEqual({
      kind: "installed",
      version: "4.1.0+maint.om",
    });
    expect(calls.filter((c) => c.startsWith("installPackage"))).toHaveLength(1);
  });

  it("lets the same library load again once the previous run settled", async () => {
    const { client } = fakeClient({ loads: [true] });
    const { ui } = fakeUi();
    const load = createLibraryLoader(ui);

    await load(client, "Modelica");

    expect(await load(client, "Modelica")).toEqual({ kind: "loaded" });
  });
});

describe("displayVersion", () => {
  it("drops semver build metadata", () => {
    expect(displayVersion("4.1.0+maint.om")).toBe("4.1.0");
    expect(displayVersion("4.1.0")).toBe("4.1.0");
  });
});

/** Yield to the microtask queue until `done` holds. */
async function flushUntil(done: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !done(); i++) await Promise.resolve();
  if (!done()) throw new Error("condition never held");
}
