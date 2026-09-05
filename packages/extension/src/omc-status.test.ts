import type {
  InstallFailure,
  InstallPhase,
  OmcResolution,
} from "@dicode/omc-bootstrap";
import type { CompatibilityReport } from "@dicode/omc-client";
import { describe, expect, it } from "vitest";

import {
  installDisclosure,
  installedMessage,
  installFailureMessage,
  installProgressMessage,
  missingOmcGuidance,
  omcStatus,
  verdictFor,
  verdictWarns,
  type OmcVerdict,
} from "./omc-status.js";

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

describe("missingOmcGuidance", () => {
  it("names the official installer on the one platform with no automated route", () => {
    expect(missingOmcGuidance("win32").message).toContain(
      "official Windows installer",
    );
    expect(missingOmcGuidance("linux").message).not.toContain("installer");
  });

  it("sends each platform to its own download page", () => {
    expect(missingOmcGuidance("win32").downloadPage).toContain("windows");
    expect(missingOmcGuidance("darwin").downloadPage).toContain("mac");
    expect(missingOmcGuidance("linux").downloadPage).toContain("linux");
  });
});

describe("verdictFor", () => {
  it("discards a verdict read from a binary other than the resolved one", () => {
    expect(
      verdictFor(onPath, verdict("untested", "1.22.0", "/opt/other/omc")),
    ).toBeUndefined();
    expect(verdictFor(onPath, verdict("untested", "1.22.0"))?.level).toBe(
      "untested",
    );
  });
});

describe("installDisclosure", () => {
  const disclosure = installDisclosure(
    "/home/u/.openmodelica/modelica-wrapper",
  );

  it("quotes what the download and the disk actually cost", () => {
    expect(disclosure.summary).toContain("0.8 GB");
    expect(disclosure.summary).toContain("4.4 GB");
    expect(disclosure.summary).toContain("3.1 GB");
  });

  it("names both hosts the bytes come from", () => {
    expect(disclosure.detail).toContain("micromamba-releases");
    expect(disclosure.detail).toContain("conda-forge");
  });

  it("says where the files land, so they can be removed by hand", () => {
    expect(disclosure.detail).toContain(
      "/home/u/.openmodelica/modelica-wrapper",
    );
  });
});

describe("installProgressMessage", () => {
  it("phrases every phase the installer can report", () => {
    const phases: InstallPhase[] = [
      "checking-space",
      "downloading-micromamba",
      "verifying-micromamba",
      "installing-openmodelica",
      "verifying-openmodelica",
      "finishing",
    ];

    for (const phase of phases) {
      expect(installProgressMessage({ phase })).not.toBe("");
    }
  });

  it("adds a percentage once the server has said how long the download is", () => {
    expect(
      installProgressMessage({
        phase: "downloading-micromamba",
        receivedBytes: 512,
        totalBytes: 2048,
      }),
    ).toContain("25%");
  });

  it("shows what the installer is doing through the phase that runs for minutes", () => {
    expect(
      installProgressMessage({
        phase: "installing-openmodelica",
        output: "Downloading packages\nLinking openmodelica-1.27.0\n",
      }),
    ).toBe("Linking openmodelica-1.27.0");
  });

  it("keeps the phase name while the installer has said nothing", () => {
    expect(
      installProgressMessage({
        phase: "installing-openmodelica",
        output: "  \n\n",
      }),
    ).toContain("OpenModelica");
  });

  it("keeps a notification-sized line out of an installer that pads with dots", () => {
    expect(
      installProgressMessage({
        phase: "installing-openmodelica",
        output: `Fetching ${".".repeat(300)} Done`,
      }).length,
    ).toBeLessThan(120);
  });

  it("claims no percentage when the server sent no length", () => {
    expect(
      installProgressMessage({
        phase: "downloading-micromamba",
        receivedBytes: 512,
      }),
    ).not.toContain("%");
  });
});

describe("verdictWarns", () => {
  it("treats an unreadable version as one an install could resolve, like an untested one", () => {
    expect(verdictWarns("untested")).toBe(true);
    expect(verdictWarns("unparseable")).toBe(true);
    expect(verdictWarns("exact")).toBe(false);
    expect(verdictWarns("minor-compatible")).toBe(false);
  });
});

describe("installFailureMessage", () => {
  it("keeps the numbers a space failure was thrown with", () => {
    expect(
      installFailureMessage({
        reason: "insufficient-space",
        message:
          "needs about 5.5 GB free under /home/u, and 0.3 GB is available.",
      }),
    ).toContain("0.3 GB");
  });

  it("says a rejected download was never run", () => {
    expect(
      installFailureMessage({
        reason: "checksum-mismatch",
        message: "micromamba hashed to abc, not the audited def.",
      }),
    ).not.toContain("abc");
  });

  it("promises an existing installation survived a failure", () => {
    expect(
      installFailureMessage({
        reason: "verification-failed",
        message: "exit 127",
      }),
    ).toContain("unchanged");
  });

  it("has a sentence for every reason the installer can stop with", () => {
    const reasons: InstallFailure[] = [
      "unsupported-platform",
      "insufficient-space",
      "download-failed",
      "checksum-mismatch",
      "install-failed",
      "verification-failed",
      "cancelled",
    ];

    for (const reason of reasons) {
      expect(
        installFailureMessage({ reason, message: "what was thrown" }),
      ).not.toBe("");
    }
  });
});

describe("installedMessage", () => {
  it("names the version, not the build string omc printed", () => {
    expect(installedMessage("v1.27.0-cmake", "/home/u/managed")).toContain(
      "OpenModelica 1.27.0",
    );
  });

  it("falls back to what was printed when it does not parse", () => {
    expect(installedMessage("nightly", "/home/u/managed")).toContain("nightly");
  });

  it("says where the files went, for a user who never opened the disclosure", () => {
    expect(installedMessage("v1.27.0-cmake", "/home/u/managed")).toContain(
      "/home/u/managed",
    );
  });
});
