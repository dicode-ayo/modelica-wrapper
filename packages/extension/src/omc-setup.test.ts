import type { FileProbe } from "@dicode/omc-bootstrap";
import { beforeEach, describe, expect, it } from "vitest";
import {
  resetStatusBarItems,
  statusBarItems,
} from "../test-support/vscode-mock.js";

import { createOmcSetup, type OmcEnvironment } from "./omc-setup.js";

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
