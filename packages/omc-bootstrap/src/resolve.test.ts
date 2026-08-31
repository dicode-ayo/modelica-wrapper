import { describe, expect, it, vi } from "vitest";

import {
  type FileProbe,
  type ResolveOmcInput,
  managedOmcBinary,
  managedRoot,
  resolveOmc,
} from "./resolve.js";

const ROOT = "/home/u/.openmodelica/modelica-wrapper";
const MANAGED_OMC = `${ROOT}/current/bin/omc`;

const probeFor = (paths: string[]): FileProbe => {
  const known = new Set(paths);
  return (absolutePath) => Promise.resolve(known.has(absolutePath));
};

const nothing = probeFor([]);
const everything: FileProbe = () => Promise.resolve(true);

const input = (overrides: Partial<ResolveOmcInput> = {}): ResolveOmcInput => ({
  setting: "",
  managedRoot: ROOT,
  pathVariable: "/usr/bin:/bin",
  platform: "linux",
  ...overrides,
});

describe("managedRoot", () => {
  it("owns a subdirectory of the one OpenModelica already owns", () => {
    expect(managedRoot("/home/u", "linux")).toBe(ROOT);
  });

  it("puts the verified installation at a fixed path under it", () => {
    expect(managedOmcBinary(ROOT, "linux")).toBe(MANAGED_OMC);
  });

  it("names the Windows binary and separator", () => {
    expect(managedRoot("C:\\Users\\u", "win32")).toBe(
      "C:\\Users\\u\\.openmodelica\\modelica-wrapper",
    );
    expect(managedOmcBinary("C:\\p", "win32")).toBe(
      "C:\\p\\current\\bin\\omc.exe",
    );
  });
});

describe("resolveOmc", () => {
  it("takes an explicit setting over anything else present", async () => {
    const resolution = await resolveOmc(
      input({ setting: "/opt/om/bin/omc" }),
      everything,
    );

    expect(resolution).toEqual({
      source: "setting",
      omcPath: "/opt/om/bin/omc",
    });
  });

  it("takes an explicit setting as given, without probing it", async () => {
    const probe = vi.fn<FileProbe>(() => Promise.resolve(false));

    const resolution = await resolveOmc(
      input({ setting: "/gone/bin/omc" }),
      probe,
    );

    expect(resolution).toEqual({ source: "setting", omcPath: "/gone/bin/omc" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("reads a whitespace-only setting as unset", async () => {
    const resolution = await resolveOmc(
      input({ setting: "   " }),
      probeFor([MANAGED_OMC]),
    );

    expect(resolution).toEqual({ source: "managed", omcPath: MANAGED_OMC });
  });

  it("trims a pasted setting", async () => {
    const resolution = await resolveOmc(
      input({ setting: "  /opt/om/bin/omc\n" }),
      nothing,
    );

    expect(resolution.omcPath).toBe("/opt/om/bin/omc");
  });

  it("takes a managed installation over one on PATH", async () => {
    const resolution = await resolveOmc(
      input(),
      probeFor([MANAGED_OMC, "/usr/bin/omc"]),
    );

    expect(resolution).toEqual({ source: "managed", omcPath: MANAGED_OMC });
  });

  it("falls back to the first omc in PATH order", async () => {
    const resolution = await resolveOmc(
      input({ pathVariable: "/usr/local/bin:/usr/bin" }),
      probeFor(["/usr/local/bin/omc", "/usr/bin/omc"]),
    );

    expect(resolution).toEqual({
      source: "path",
      omcPath: "/usr/local/bin/omc",
    });
  });

  it("skips PATH entries that resolve against the working directory", async () => {
    const resolution = await resolveOmc(
      input({ pathVariable: ":vendor/bin:/usr/bin" }),
      probeFor(["vendor/bin/omc", "/usr/bin/omc"]),
    );

    expect(resolution).toEqual({ source: "path", omcPath: "/usr/bin/omc" });
  });

  it("reports missing rather than a path nothing sits at", async () => {
    const resolution = await resolveOmc(input(), nothing);

    expect(resolution).toEqual({ source: "missing" });
    expect(resolution.omcPath).toBeUndefined();
  });

  it("searches a Windows PATH for omc.exe", async () => {
    const resolution = await resolveOmc(
      input({
        managedRoot: "C:\\Users\\u\\.openmodelica\\modelica-wrapper",
        pathVariable: "C:\\tools;C:\\Program Files\\OpenModelica\\bin",
        platform: "win32",
      }),
      probeFor(["C:\\Program Files\\OpenModelica\\bin\\omc.exe"]),
    );

    expect(resolution).toEqual({
      source: "path",
      omcPath: "C:\\Program Files\\OpenModelica\\bin\\omc.exe",
    });
  });
});
