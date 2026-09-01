import { readFileSync } from "node:fs";

import {
  OmcInstallError,
  type FileProbe,
  type InstallOmcInput,
  type InstallOmcResult,
  type RemoveOmcInput,
} from "@dicode/omc-bootstrap";
import { SUPPORTED_OMC, type CompatibilityReport } from "@dicode/omc-client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  progressRuns,
  queueMessageAnswers,
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
} from "../test-support/vscode-mock.js";

import type { InstallHooks, OmcInstaller } from "./omc-install-host.js";
import { createOmcSetup, type OmcEnvironment } from "./omc-setup.js";
import { REMOVE_TITLE } from "./omc-status.js";

const untested: CompatibilityReport = {
  omc: { major: 1, minor: 22, patch: 0, raw: "OpenModelica 1.22.0" },
  supportedPrimary: SUPPORTED_OMC.primary,
  level: "untested",
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
    setup.dispose();
  });

  it("says nothing failed when the user cancelled it", async () => {
    let release = (): void => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setup = createOmcSetup({
      environment: environment(() => Promise.resolve(false)),
      installer: recordingInstaller({
        install: async () => {
          await blocked;
          throw new OmcInstallError("cancelled", "aborted");
        },
      }),
    });

    const running = runCommand(INSTALL_COMMAND);
    progressRuns.at(-1)?.cancel();
    release();
    await running;

    expect(errors()).toEqual([]);
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

  it("contributes every command it registers, or the palette cannot reach it", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      contributes: { commands: Array<{ command: string; title: string }> };
    };
    const titles = new Map(
      manifest.contributes.commands.map((c) => [c.command, c.title]),
    );

    expect(titles.has(INSTALL_COMMAND)).toBe(true);
    // The disclosure tells the user to run this by name.
    expect(titles.get(REMOVE_COMMAND)).toBe(REMOVE_TITLE);
  });
});
