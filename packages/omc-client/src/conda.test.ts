import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { type DirectoryProbe, condaActivatedEnv } from "./conda.js";

const PREFIX = "/home/u/.openmodelica/modelica-wrapper/omc";
const CONDA_BIN = `${PREFIX}/bin`;
const CONDA_OMC = `${CONDA_BIN}/omc`;

const probeFor = (directories: string[]): DirectoryProbe => {
  const known = new Set(directories);
  return (absolutePath) => Promise.resolve(known.has(absolutePath));
};

const condaProbe = probeFor([`${PREFIX}/conda-meta`]);

describe("condaActivatedEnv", () => {
  it.each([
    {
      what: "prepends the environment's bin for a binary inside one",
      binary: CONDA_OMC,
      path: "/usr/bin:/bin",
      expected: `${CONDA_BIN}:/usr/bin:/bin`,
    },
    {
      what: "leaves PATH alone for a binary outside one",
      binary: "/usr/bin/omc",
      path: "/usr/bin:/bin",
      expected: "/usr/bin:/bin",
    },
    {
      what: "leaves PATH alone for a bare name resolved from PATH",
      binary: "omc",
      path: `${CONDA_BIN}:/usr/bin`,
      expected: `${CONDA_BIN}:/usr/bin`,
    },
    {
      what: "makes the environment's bin the whole PATH when there was none",
      binary: CONDA_OMC,
      path: undefined,
      expected: CONDA_BIN,
    },
    {
      what: "does not leave an empty entry behind for an empty PATH",
      binary: CONDA_OMC,
      path: "",
      expected: CONDA_BIN,
    },
  ])("$what", async ({ binary, path, expected }) => {
    const env = await condaActivatedEnv(binary, { PATH: path }, condaProbe);

    expect(env.PATH).toBe(expected);
  });

  it("resolves a relative path before looking for the environment", async () => {
    const prefix = resolve("vendor/omc-prefix");
    const probe = probeFor([join(prefix, "conda-meta")]);

    const env = await condaActivatedEnv(
      "vendor/omc-prefix/bin/omc",
      { PATH: "/usr/bin" },
      probe,
    );

    expect(env.PATH).toBe(`${join(prefix, "bin")}:/usr/bin`);
  });

  it("carries the rest of the environment through untouched", async () => {
    const env = await condaActivatedEnv(
      CONDA_OMC,
      { PATH: "/usr/bin", TMPDIR: "/tmp/mw", USER: "wrapper" },
      condaProbe,
    );

    expect(env).toEqual({
      PATH: `${CONDA_BIN}:/usr/bin`,
      TMPDIR: "/tmp/mw",
      USER: "wrapper",
    });
  });

  it("does not mutate the environment it was given", async () => {
    const base = { PATH: "/usr/bin" };

    await condaActivatedEnv(CONDA_OMC, base, condaProbe);

    expect(base).toEqual({ PATH: "/usr/bin" });
  });

  it("does not probe a relative path for a bare name", async () => {
    const probe = vi.fn<DirectoryProbe>(() => Promise.resolve(true));

    const env = await condaActivatedEnv("omc", { PATH: "/usr/bin" }, probe);

    expect(probe).not.toHaveBeenCalled();
    expect(env.PATH).toBe("/usr/bin");
  });
});
