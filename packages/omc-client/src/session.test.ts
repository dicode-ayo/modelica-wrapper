import { describe, expect, it } from "vitest";

import {
  SESSION_DIR_PREFIX,
  isPortFileName,
  ownerPidFromSessionDir,
  portFileName,
  sessionDirPrefix,
  suffixFromPortFileName,
} from "./session.js";

/** What `mkdtemp` makes of a prefix: six random alphanumerics appended. */
function mkdtempName(prefix: string): string {
  return `${prefix}Ab3xY9`;
}

describe("session directory naming", () => {
  it("round-trips the owner pid through a mkdtemp name", () => {
    const name = mkdtempName(sessionDirPrefix(4242));

    expect(name.startsWith(SESSION_DIR_PREFIX)).toBe(true);
    expect(ownerPidFromSessionDir(name)).toBe(4242);
  });

  it("reads no pid from a name that predates the scheme", () => {
    expect(ownerPidFromSessionDir(mkdtempName(SESSION_DIR_PREFIX))).toBe(
      undefined,
    );
  });

  it("reads no pid from a stamp that is not purely numeric", () => {
    expect(ownerPidFromSessionDir(`${SESSION_DIR_PREFIX}42abc-Ab3xY9`)).toBe(
      undefined,
    );
  });

  it("reads no pid from a zero stamp", () => {
    expect(ownerPidFromSessionDir(`${SESSION_DIR_PREFIX}0-Ab3xY9`)).toBe(
      undefined,
    );
  });
});

describe("port file naming", () => {
  it("round-trips the zeromq suffix", () => {
    const name = portFileName("mw_deadbeef");

    expect(isPortFileName(name)).toBe(true);
    expect(suffixFromPortFileName(name)).toBe("mw_deadbeef");
  });

  it("recognises the Windows variant, which drops the user segment", () => {
    expect(isPortFileName("openmodelica.port.mw_deadbeef")).toBe(true);
    expect(suffixFromPortFileName("openmodelica.port.mw_deadbeef")).toBe(
      "mw_deadbeef",
    );
  });

  it("rejects the other files OMC leaves in its tempdir", () => {
    expect(isPortFileName("omc.pid")).toBe(false);
    expect(isPortFileName("openmodelica.scratch")).toBe(false);
  });

  it("reads no suffix from a truncated name", () => {
    expect(suffixFromPortFileName("openmodelica.mw.port.")).toBe(undefined);
    expect(suffixFromPortFileName("nonsense")).toBe(undefined);
  });
});
