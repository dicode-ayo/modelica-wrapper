/**
 * Unit tests for the OMC port-file path computation and env construction.
 *
 * OMC builds the port-file path from `${TMPDIR}/openmodelica.${USER}.port.${suffix}`
 * (Windows: drops the user segment via a compile-time branch in `zeromqimpl.c`).
 * We control the inputs by handing OMC its own per-spawn tempdir and a fixed
 * sentinel `USER`. These tests pin the deterministic path computation and the
 * env-override behavior on each platform without spawning OMC.
 */

import { describe, expect, it, vi } from "vitest";

import { omcEnv, portFilePath } from "./process.js";

describe("portFilePath", () => {
  const tempDir = "/tmp/mw-omc-abc";
  const suffix = "mw_test_suffix";

  it("includes the wrapper-sentinel user segment on Unix", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    expect(portFilePath(tempDir, suffix)).toBe(
      `${tempDir}/openmodelica.mw.port.${suffix}`,
    );
  });

  it("matches Unix shape on macOS (darwin)", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    expect(portFilePath(tempDir, suffix)).toBe(
      `${tempDir}/openmodelica.mw.port.${suffix}`,
    );
  });

  it("drops the user segment on Windows", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    // path.join uses backslashes on Windows, but vitest is running on the host
    // platform, so test the trailing component independent of separator.
    expect(portFilePath(tempDir, suffix)).toMatch(
      /openmodelica\.port\.mw_test_suffix$/,
    );
    expect(portFilePath(tempDir, suffix)).not.toContain("openmodelica.mw.");
  });
});

describe("omcEnv", () => {
  const tempDir = "/tmp/mw-omc-abc";

  it("sets TMPDIR and USER on Unix", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const env = omcEnv(tempDir);
    expect(env.TMPDIR).toBe(tempDir);
    expect(env.USER).toBe("mw");
    expect(env.TMP).toBeUndefined();
  });

  it("sets TMP and TEMP on Windows; does not set USER", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const env = omcEnv(tempDir);
    expect(env.TMP).toBe(tempDir);
    expect(env.TEMP).toBe(tempDir);
    // USER segment is dropped at the C level on Windows; setting it is moot.
    // The env block does not need to override it (callers may still have USER).
    expect(env.TMPDIR).toBeUndefined();
  });

  it("inherits other env vars from process.env", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    process.env.MW_TEST_SENTINEL = "kept";
    try {
      const env = omcEnv(tempDir);
      expect(env.MW_TEST_SENTINEL).toBe("kept");
      expect(env.PATH).toBe(process.env.PATH);
    } finally {
      delete process.env.MW_TEST_SENTINEL;
    }
  });
});
