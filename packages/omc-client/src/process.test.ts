import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    userInfo: vi.fn(actual.userInfo),
  };
});

import * as os from "node:os";

import { portFilePaths } from "./process.js";

const userInfoMock = vi.mocked(os.userInfo);

afterEach(() => {
  userInfoMock.mockReset();
});

describe("portFilePaths", () => {
  const suffix = "mw_test_suffix";
  const tmp = tmpdir();

  it("returns only the user-prefixed path for non-root users", () => {
    userInfoMock.mockReturnValue({
      username: "alice",
      uid: 1000,
      gid: 1000,
      shell: "/bin/bash",
      homedir: "/home/alice",
    });

    const paths = portFilePaths(suffix);
    expect(paths).toEqual([join(tmp, `openmodelica.alice.port.${suffix}`)]);
  });

  it("returns unprefixed path first, then user-prefixed, for uid 0 (root)", () => {
    userInfoMock.mockReturnValue({
      username: "root",
      uid: 0,
      gid: 0,
      shell: "/bin/bash",
      homedir: "/root",
    });

    const paths = portFilePaths(suffix);
    expect(paths).toEqual([
      join(tmp, `openmodelica.port.${suffix}`),
      join(tmp, `openmodelica.root.port.${suffix}`),
    ]);
  });

  it("treats username 'root' as root even if uid is reported non-zero", () => {
    // Some container setups report a non-zero uid for username 'root'.
    userInfoMock.mockReturnValue({
      username: "root",
      uid: 1234,
      gid: 0,
      shell: "/bin/bash",
      homedir: "/root",
    });

    const paths = portFilePaths(suffix);
    expect(paths[0]).toBe(join(tmp, `openmodelica.port.${suffix}`));
    expect(paths).toContain(join(tmp, `openmodelica.root.port.${suffix}`));
  });

  it("strips a DOMAIN\\ prefix from the username on edge-case setups", () => {
    userInfoMock.mockReturnValue({
      username: "DOMAIN\\bob",
      uid: 1001,
      gid: 1001,
      shell: "/bin/bash",
      homedir: "/home/bob",
    });

    const paths = portFilePaths(suffix);
    expect(paths).toEqual([join(tmp, `openmodelica.bob.port.${suffix}`)]);
  });
});
