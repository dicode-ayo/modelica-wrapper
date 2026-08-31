import type { OmcResolution } from "@dicode/omc-bootstrap";
import type { CompatibilityReport } from "@dicode/omc-client";
import { describe, expect, it } from "vitest";

import { omcStatus, type OmcVerdict } from "./omc-status.js";

const OMC = "/usr/bin/omc";
const onPath: OmcResolution = { source: "path", omcPath: OMC };

function verdict(
  level: CompatibilityReport["level"],
  raw?: string,
  omcPath = OMC,
): OmcVerdict {
  return {
    omcPath,
    report: {
      omc:
        raw === undefined ? undefined : { major: 1, minor: 27, patch: 0, raw },
      supportedPrimary: "1.27.0",
      level,
    },
  };
}

describe("omcStatus", () => {
  it("asks for attention when there is no OpenModelica", () => {
    const status = omcStatus({ source: "missing" }, undefined);

    expect(status.warn).toBe(true);
    expect(status.text).toContain("not found");
  });

  it("names which of the three OpenModelicas is in use", () => {
    expect(omcStatus(onPath, undefined).tooltip).toContain("PATH");
    expect(
      omcStatus({ source: "setting", omcPath: "/opt/omc" }, undefined).tooltip,
    ).toContain("modelica.omcPath");
    expect(
      omcStatus({ source: "managed", omcPath: "/home/u/omc" }, undefined)
        .tooltip,
    ).toContain("installed");
  });

  it("carries the resolved path so a user can see what was picked", () => {
    expect(omcStatus(onPath, undefined).tooltip).toContain(OMC);
  });

  it("claims no version before a client has connected", () => {
    const status = omcStatus(onPath, undefined);

    expect(status.text).toBe("$(circuit-board) OpenModelica");
    expect(status.warn).toBe(false);
  });

  it("shows the version once the verdict arrives", () => {
    expect(
      omcStatus(onPath, verdict("exact", "OpenModelica 1.27.0")).text,
    ).toBe("$(circuit-board) OpenModelica 1.27.0");
  });

  it("shortens a development build to its version triple", () => {
    expect(
      omcStatus(onPath, verdict("minor-compatible", "v1.27.0-dev-184-gabc"))
        .text,
    ).toBe("$(circuit-board) OpenModelica 1.27.0");
  });

  it("ignores a verdict read from a different binary", () => {
    const stale = verdict("untested", "OpenModelica 1.22.0", "/opt/other/omc");
    const status = omcStatus(onPath, stale);

    expect(status.text).toBe("$(circuit-board) OpenModelica");
    expect(status.warn).toBe(false);
  });

  it("warns about a version the wrappers were never audited against", () => {
    const status = omcStatus(
      onPath,
      verdict("untested", "OpenModelica 1.22.0"),
    );

    expect(status.warn).toBe(true);
    expect(status.tooltip).toContain("1.27.0");
  });

  it("warns, and invents no version, when the version cannot be read", () => {
    const status = omcStatus(onPath, verdict("unparseable"));

    expect(status.warn).toBe(true);
    expect(status.text).toBe("$(circuit-board) OpenModelica");
  });

  it("does not warn about a compatible version", () => {
    expect(
      omcStatus(onPath, verdict("exact", "OpenModelica 1.27.0")).warn,
    ).toBe(false);
  });
});
