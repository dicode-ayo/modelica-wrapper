import { readFileSync } from "node:fs";

import {
  OmcInstallError,
  type FileProbe,
  type InstallOmcInput,
  type InstallOmcResult,
  type RemoveOmcInput,
} from "@dicode/omc-bootstrap";
import { SUPPORTED_OMC, type CompatibilityReport } from "@dicode/omc-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConfigurationTarget,
  configurationUpdates,
  openedExternals,
  progressRuns,
  queueMessageAnswers,
  queueOpenDialogPicks,
  recordedMessages,
  recordedPrompts,
  resetCommands,
  resetConfiguration,
  resetMessages,
  resetProgressRuns,
  resetStatusBarItems,
  runCommand,
  setConfiguration,
  statusBarItems,
  Uri,
} from "../test-support/vscode-mock.js";

import type { InstallHooks, OmcInstaller } from "./omc-install-host.js";
import { createOmcSetup, type OmcEnvironment } from "./omc-setup.js";
import { REMOVE_TITLE } from "./omc-status.js";

const untested: CompatibilityReport = {
  omc: { major: 1, minor: 22, patch: 0, raw: "OpenModelica 1.22.0" },
  supportedPrimary: SUPPORTED_OMC.primary,
  level: "untested",
};

const unparseable: CompatibilityReport = {
  omc: undefined,
  supportedPrimary: SUPPORTED_OMC.primary,
  level: "unparseable",
};

const HOME = "/home/u";
const MANAGED = `${HOME}/.openmodelica/modelica-wrapper/current/bin/omc`;
const ON_PATH = "/slow/omc";

function shown(): { text: string; tooltip: string | undefined } {
  const item = statusBarItems.at(-1);
  if (item === undefined) throw new Error("no status bar item was created");
  return { text: item.text, tooltip: item.tooltip };
}

function environment(probe: FileProbe): OmcEnvironment {
  return {
    homeDir: HOME,
    pathVariable: "/slow",
    platform: "linux",
    arch: "x64",
    probe,
  };
}

describe("createOmcSetup", () => {
  beforeEach(resetStatusBarItems);

  it("keeps the newest resolution when an earlier probe lands later", async () => {
    let releaseSweep = (): void => {};
    const sweeping = new Promise<void>((resolve) => {
      releaseSweep = resolve;
    });
    let managedInstalled = false;
    const probe: FileProbe = async (candidate) => {
      if (candidate === MANAGED) return managedInstalled;
      if (candidate === ON_PATH) {
        await sweeping;
        return true;
      }
      return false;
    };
    const setup = createOmcSetup({ environment: environment(probe) });

    const sweep = setup.omcPath();
    managedInstalled = true;
    await setup.omcPath();
    releaseSweep();

    await expect(sweep).resolves.toBe(ON_PATH);
    expect(shown().tooltip).toContain(MANAGED);
    setup.dispose();
  });

  it("names the missing dependency rather than letting a spawn fail with ENOENT", async () => {
    const setup = createOmcSetup({
      environment: environment(() => Promise.resolve(false)),
    });

    await expect(setup.omcPath()).rejects.toThrow(/OpenModelica was not found/);
    expect(shown().text).toContain("not found");
    setup.dispose();
  });

  it("reports an omc that appeared, but says nothing about the first look", async () => {
    let installed = false;
    let changes = 0;
    const setup = createOmcSetup({
      environment: environment((candidate) =>
        Promise.resolve(candidate === MANAGED && installed),
      ),
      onOmcChanged: () => {
        changes += 1;
      },
    });

    await expect(setup.omcPath()).rejects.toThrow();
    expect(changes).toBe(0);

    installed = true;
    await expect(setup.omcPath()).resolves.toBe(MANAGED);
    expect(changes).toBe(1);

    await setup.omcPath();
    expect(changes).toBe(1);
    setup.dispose();
  });
});

const INSTALL_COMMAND = "modelica.installOmc";
const REMOVE_COMMAND = "modelica.removeOmc";
const SETUP_COMMAND = "modelica.setupOmc";

/** An installer that records what it was asked for and never touches a disk. */
function recordingInstaller(behaviour: {
  install?: (
    input: InstallOmcInput,
    hooks: InstallHooks,
  ) => Promise<InstallOmcResult>;
  remove?: () => Promise<boolean>;
}): OmcInstaller & {
  installs: InstallOmcInput[];
  removals: RemoveOmcInput[];
} {
  const installs: InstallOmcInput[] = [];
  const removals: RemoveOmcInput[] = [];
  return {
    installs,
    removals,
    install: async (input, hooks) => {
      installs.push(input);
      return await (behaviour.install?.(input, hooks) ??
        Promise.resolve({ omcPath: MANAGED, version: "OpenModelica 1.27.0" }));
    },
    remove: async (input) => {
      removals.push(input);
      return await (behaviour.remove?.() ?? Promise.resolve(true));
    },
  };
}

/** The actions the most recent message offered. */
function offered(): string[] {
  const prompt = recordedPrompts.at(-1);
  if (prompt === undefined) throw new Error("no message offered actions");
  return prompt.items;
}

function errors(): string[] {
  return recordedMessages
    .filter((m) => m.level === "error")
    .map((m) => m.message);
}

describe("the managed install", () => {
  beforeEach(() => {
    resetStatusBarItems();
    resetCommands();
    resetMessages();
    resetConfiguration();
    resetProgressRuns();
  });

  it("never offers Windows an install conda-forge cannot perform", async () => {
    const setup = createOmcSetup({
      environment: {
        ...environment(() => Promise.resolve(false)),
        platform: "win32",
      },
      installer: recordingInstaller({}),
    });

    await setup.start();

    expect(offered()).not.toContain("Install for me");
    setup.dispose();
  });

  it("offers an install where conda-forge has a package", async () => {
    const setup = createOmcSetup({
      environment: environment(() => Promise.resolve(false)),
      installer: recordingInstaller({}),
    });

    await setup.start();

    expect(offered()).toContain("Install for me");
    setup.dispose();
  });

  it("installs the version the wrappers were audited against", async () => {
    const installer = recordingInstaller({});
    const setup = createOmcSetup({
      environment: environment(() => Promise.resolve(false)),
      installer,
    });

    await runCommand(INSTALL_COMMAND);

    expect(installer.installs.at(0)?.version).toBe(SUPPORTED_OMC.primary);
    setup.dispose();
  });

  it("hands the editor's proxy to the install", async () => {
    setConfiguration("http.proxy", "http://proxy.example:3128");
    const installer = recordingInstaller({});
    const setup = createOmcSetup({
      environment: environment(() => Promise.resolve(false)),
      installer,
    });

    await runCommand(INSTALL_COMMAND);

    expect(installer.installs.at(0)?.proxy).toBe("http://proxy.example:3128");
    setup.dispose();
  });

  it("re-resolves once an install lands, since no setting was written", async () => {
    let installed = false;
    let changes = 0;
    const setup = createOmcSetup({
      environment: environment((candidate) =>
        Promise.resolve(candidate === MANAGED && installed),
      ),
      onOmcChanged: () => {
        changes += 1;
      },
      installer: recordingInstaller({
        install: () => {
          installed = true;
          return Promise.resolve({
            omcPath: MANAGED,
            version: "OpenModelica 1.27.0",
          });
        },
      }),
    });
    await setup.start();
    expect(changes).toBe(0);

    await runCommand(INSTALL_COMMAND);

    expect(changes).toBe(1);
    expect(shown().tooltip).toContain(MANAGED);
    // ADR 0002: an install is not a stated choice, so it writes no setting.
    expect(configurationUpdates).toEqual([]);
    setup.dispose();
  });

  it("replaces the session after an update, which leaves the path unchanged", async () => {
    let changes = 0;
    const setup = createOmcSetup({
      environment: environment((candidate) =>
        Promise.resolve(candidate === MANAGED),
      ),
      onOmcChanged: () => {
        changes += 1;
      },
      installer: recordingInstaller({}),
    });
    await setup.start();
    expect(changes).toBe(0);

    await runCommand(INSTALL_COMMAND);

    // An update swaps the prefix under the same path, so comparing paths
    // cannot see it — but the session is running the binary that was replaced.
    expect(changes).toBe(1);
    setup.dispose();
  });

  it("keeps the replacement signal when a later resolution supersedes the install's", async () => {
    let changes = 0;
    let gated = false;
    let enteredProbe = (): void => {};
    const entered = new Promise<void>((resolve) => {
      enteredProbe = resolve;
    });
    let releaseProbe = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const probe: FileProbe = async (candidate) => {
      if (candidate !== MANAGED) return false;
      if (gated) {
        enteredProbe();
        await gate;
      }
      return true;
    };
    const setup = createOmcSetup({
      environment: environment(probe),
      onOmcChanged: () => {
        changes += 1;
      },
      installer: recordingInstaller({
        install: () => {
          // The resolution that follows this is the one carrying the signal.
          gated = true;
          return Promise.resolve({
            omcPath: MANAGED,
            version: "v1.27.0-cmake",
          });
        },
      }),
    });
    await setup.start();
    expect(changes).toBe(0);

    const installing = runCommand(INSTALL_COMMAND);
    await entered;
    // A spawn resolving here takes the newest generation, so the install's own
    // resolution is discarded — with the fact that the binary was replaced.
    const spawning = setup.omcPath();
    releaseProbe();
    await Promise.all([installing, spawning]);

    expect(changes).toBe(1);
    setup.dispose();
  });

  it("says nothing failed when the user cancelled it", async () => {
    let started = (): void => {};
    const underway = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release = (): void => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let aborted: boolean | undefined;
    const setup = createOmcSetup({
      environment: environment(() => Promise.resolve(false)),
      installer: recordingInstaller({
        install: async (_input, hooks) => {
          started();
          await blocked;
          aborted = hooks.signal.aborted;
          throw new OmcInstallError("cancelled", "aborted");
        },
      }),
    });

    const running = runCommand(INSTALL_COMMAND);
    await underway;
    const notification = progressRuns.at(-1);
    if (notification === undefined) {
      throw new Error("the install showed no progress notification");
    }
    notification.cancel();
    release();
    await running;

    // Cancelling the notification has to reach the installer, not merely stop
    // the extension from reporting what it did.
    expect(aborted).toBe(true);
    expect(errors()).toEqual([]);
    setup.dispose();
  });

  it("holds a removal back while an install is building the prefix it would delete", async () => {
    let started = (): void => {};
    const underway = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release = (): void => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const installer = recordingInstaller({
      install: async () => {
        started();
        await blocked;
        return { omcPath: MANAGED, version: "v1.27.0-cmake" };
      },
    });
    const setup = createOmcSetup({
      environment: environment(() => Promise.resolve(false)),
      installer,
    });

    const installing = runCommand(INSTALL_COMMAND);
    await underway;
    queueMessageAnswers("Remove");
    const removing = runCommand(REMOVE_COMMAND);
    release();
    await Promise.all([installing, removing]);

    expect(installer.removals).toEqual([]);
    setup.dispose();
  });

  it("refuses to install four gigabytes a stated omcPath would outrank", async () => {
    setConfiguration("modelica.omcPath", "/opt/omc");
    const installer = recordingInstaller({});
    const setup = createOmcSetup({
      environment: environment(() => Promise.resolve(false)),
      installer,
    });

    await runCommand(INSTALL_COMMAND);

    expect(installer.installs).toEqual([]);
    expect(recordedMessages.at(-1)?.message).toContain("modelica.omcPath");
    setup.dispose();
  });

  it("offers a way out of the warning an unreadable version raises", async () => {
    const setup = createOmcSetup({
      environment: environment((candidate) =>
        Promise.resolve(candidate === ON_PATH),
      ),
      installer: recordingInstaller({}),
    });
    await setup.start();
    await setup.reportVersion(
      { getVersionStatus: () => Promise.resolve(unparseable) },
      ON_PATH,
    );

    await runCommand(SETUP_COMMAND);

    expect(offered()).toContain("Update OpenModelica");
    setup.dispose();
  });

  it("turns the reason an install stopped into a sentence", async () => {
    const setup = createOmcSetup({
      environment: environment(() => Promise.resolve(false)),
      installer: recordingInstaller({
        install: () =>
          Promise.reject(
            new OmcInstallError(
              "checksum-mismatch",
              "micromamba hashed to abc, not the audited def.",
            ),
          ),
      }),
    });

    await runCommand(INSTALL_COMMAND);

    expect(errors().at(0)).toContain("checksum");
    expect(errors().at(0)).not.toContain("abc");
    setup.dispose();
  });

  it("routes a caller-contract bug away from a worded failure", async () => {
    const setup = createOmcSetup({
      environment: environment(() => Promise.resolve(false)),
      installer: recordingInstaller({
        install: () =>
          Promise.reject(new Error('"1.x" is not a concrete version.')),
      }),
    });

    await runCommand(INSTALL_COMMAND);

    expect(errors().at(0)).toContain("unexpectedly");
    setup.dispose();
  });

  it("joins a second install onto the first rather than clearing its staging", async () => {
    let release = (): void => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const installer = recordingInstaller({
      install: async () => {
        await blocked;
        return { omcPath: MANAGED, version: "OpenModelica 1.27.0" };
      },
    });
    const setup = createOmcSetup({
      environment: environment(() => Promise.resolve(false)),
      installer,
    });

    const first = runCommand(INSTALL_COMMAND);
    const second = runCommand(INSTALL_COMMAND);
    release();
    await Promise.all([first, second]);

    expect(installer.installs).toHaveLength(1);
    setup.dispose();
  });

  it("takes a declined confirmation as a no", async () => {
    const installer = recordingInstaller({});
    const setup = createOmcSetup({
      environment: environment(() => Promise.resolve(true)),
      installer,
    });
    queueMessageAnswers(undefined);

    await runCommand(REMOVE_COMMAND);

    expect(installer.removals).toEqual([]);
    setup.dispose();
  });

  it("re-resolves after a removal, so the status bar stops naming what is gone", async () => {
    let installed = true;
    let changes = 0;
    const setup = createOmcSetup({
      environment: environment((candidate) =>
        Promise.resolve(candidate === MANAGED && installed),
      ),
      onOmcChanged: () => {
        changes += 1;
      },
      installer: recordingInstaller({
        remove: () => {
          installed = false;
          return Promise.resolve(true);
        },
      }),
    });
    await setup.start();
    queueMessageAnswers("Remove");

    await runCommand(REMOVE_COMMAND);

    expect(changes).toBe(1);
    expect(shown().text).toContain("not found");
    setup.dispose();
  });

  it("offers to update an untested OpenModelica a managed one would replace", async () => {
    const setup = createOmcSetup({
      environment: environment((candidate) =>
        Promise.resolve(candidate === ON_PATH),
      ),
      installer: recordingInstaller({}),
    });
    await setup.start();
    await setup.reportVersion(
      { getVersionStatus: () => Promise.resolve(untested) },
      ON_PATH,
    );

    await runCommand(SETUP_COMMAND);

    expect(offered()).toContain("Update OpenModelica");
    setup.dispose();
  });

  it("offers no update to a stated omcPath, which an install could never displace", async () => {
    setConfiguration("modelica.omcPath", "/opt/omc");
    const setup = createOmcSetup({
      environment: environment(() => Promise.resolve(false)),
      installer: recordingInstaller({}),
    });
    await setup.start();
    await setup.reportVersion(
      { getVersionStatus: () => Promise.resolve(untested) },
      "/opt/omc",
    );

    await runCommand(SETUP_COMMAND);

    expect(offered()).not.toContain("Update OpenModelica");
    setup.dispose();
  });

  it("sends the one platform with no automated route to its own installer page", async () => {
    const setup = createOmcSetup({
      environment: {
        ...environment(() => Promise.resolve(false)),
        platform: "win32",
      },
      installer: recordingInstaller({}),
    });
    queueMessageAnswers("Get OpenModelica");

    await setup.start();

    expect(openedExternals.at(-1)?.toString()).toContain("windows");
    setup.dispose();
  });

  it("writes modelica.omcPath from the file picker and from nowhere else", async () => {
    let changes = 0;
    const setup = createOmcSetup({
      environment: environment(() => Promise.resolve(false)),
      onOmcChanged: () => {
        changes += 1;
      },
      installer: recordingInstaller({}),
    });
    queueMessageAnswers("Locate omc...");
    queueOpenDialogPicks(Uri.file("/opt/omc"));

    await setup.start();

    expect(configurationUpdates).toEqual([
      {
        key: "modelica.omcPath",
        value: "/opt/omc",
        target: ConfigurationTarget.Global,
      },
    ]);
    // The write is what re-resolves, and the session has to follow: an `omc`
    // located after activation otherwise leaves the library tree empty.
    await vi.waitFor(() => {
      expect(changes).toBe(1);
    });
    setup.dispose();
  });

  it("contributes every command it registers, or the palette cannot reach it", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      contributes: { commands: Array<{ command: string; title: string }> };
    };
    const titles = new Map(
      manifest.contributes.commands.map((c) => [c.command, c.title]),
    );

    expect(titles.has(SETUP_COMMAND)).toBe(true);
    expect(titles.has(INSTALL_COMMAND)).toBe(true);
    // The disclosure tells the user to run this by name.
    expect(titles.get(REMOVE_COMMAND)).toBe(REMOVE_TITLE);
  });
});
