/**
 * Unit tests for the session-configuration wrappers — no OMC contact. Each
 * argument is a `String`, so it must reach OMC quoted: a bare path or version
 * would be resolved as a name in scope.
 */

import { describe, expect, it, vi } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { getEnvironmentVar } from "./getEnvironmentVar.js";
import { getInstallationDirectoryPath } from "./getInstallationDirectoryPath.js";
import { getLanguageStandard } from "./getLanguageStandard.js";
import { getTempDirectoryPath } from "./getTempDirectoryPath.js";
import { setEnvironmentVar } from "./setEnvironmentVar.js";
import { setInstallationDirectoryPath } from "./setInstallationDirectoryPath.js";
import { setLanguageStandard } from "./setLanguageStandard.js";
import { setModelicaPath } from "./setModelicaPath.js";
import { setTempDirectoryPath } from "./setTempDirectoryPath.js";

function fakeCtx(response: string): {
  ctx: CallContext;
  call: ReturnType<typeof vi.fn>;
} {
  const call = vi.fn(async () => response);
  const ctx: CallContext = {
    call: call as unknown as CallContext["call"],
    getErrorString: async () => ({ errorString: "" }),
  };
  return { ctx, call };
}

describe("session-configuration getters", () => {
  it("getInstallationDirectoryPath decodes the directory", async () => {
    const { ctx, call } = fakeCtx('"/usr/bin/.."');
    expect(await getInstallationDirectoryPath(ctx)).toEqual({
      installationDirectoryPath: "/usr/bin/..",
    });
    expect(call).toHaveBeenCalledWith("getInstallationDirectoryPath()");
  });

  it("getTempDirectoryPath decodes the directory", async () => {
    const { ctx, call } = fakeCtx('"/tmp"');
    expect(await getTempDirectoryPath(ctx)).toEqual({
      tempDirectoryPath: "/tmp",
    });
    expect(call).toHaveBeenCalledWith("getTempDirectoryPath()");
  });

  it("getLanguageStandard decodes the version", async () => {
    const { ctx, call } = fakeCtx('"3.6"');
    expect(await getLanguageStandard(ctx)).toEqual({ outVersion: "3.6" });
    expect(call).toHaveBeenCalledWith("getLanguageStandard()");
  });

  it("getEnvironmentVar quotes the name and reads an unset variable as empty", async () => {
    const { ctx, call } = fakeCtx('""');
    expect(
      await getEnvironmentVar(ctx, { var: "OPENMODELICALIBRARY" }),
    ).toEqual({ value: "" });
    expect(call).toHaveBeenCalledWith(
      'getEnvironmentVar("OPENMODELICALIBRARY")',
    );
  });

  it("rejects a non-string answer rather than coercing it", async () => {
    const { ctx } = fakeCtx("true");
    await expect(getLanguageStandard(ctx)).rejects.toThrow();
  });
});

describe("session-configuration setters", () => {
  it("setModelicaPath quotes the path, separators and all", async () => {
    const { ctx, call } = fakeCtx("true");
    expect(
      await setModelicaPath(ctx, {
        modelicaPath: "/ws/lib:/usr/lib/omlibrary",
      }),
    ).toEqual({ success: true });
    expect(call).toHaveBeenCalledWith(
      'setModelicaPath("/ws/lib:/usr/lib/omlibrary")',
    );
  });

  it("setModelicaPath escapes a quote and a backslash inside the path", async () => {
    const { ctx, call } = fakeCtx("true");
    await setModelicaPath(ctx, { modelicaPath: 'C:\\lib\\"x"' });
    expect(call).toHaveBeenCalledWith(
      'setModelicaPath("C:\\\\lib\\\\\\"x\\"")',
    );
  });

  it("setInstallationDirectoryPath quotes the directory", async () => {
    const { ctx, call } = fakeCtx("true");
    await setInstallationDirectoryPath(ctx, {
      installationDirectoryPath: "/opt/om",
    });
    expect(call).toHaveBeenCalledWith(
      'setInstallationDirectoryPath("/opt/om")',
    );
  });

  it("setTempDirectoryPath quotes the directory", async () => {
    const { ctx, call } = fakeCtx("true");
    await setTempDirectoryPath(ctx, { tempDirectoryPath: "/scratch" });
    expect(call).toHaveBeenCalledWith('setTempDirectoryPath("/scratch")');
  });

  it("setLanguageStandard quotes the version", async () => {
    const { ctx, call } = fakeCtx("true");
    await setLanguageStandard(ctx, { inVersion: "3.5" });
    expect(call).toHaveBeenCalledWith('setLanguageStandard("3.5")');
  });

  it("setEnvironmentVar quotes both name and value, in OMC's order", async () => {
    const { ctx, call } = fakeCtx("true");
    await setEnvironmentVar(ctx, { var: "FOO", value: "a b" });
    expect(call).toHaveBeenCalledWith('setEnvironmentVar("FOO", "a b")');
  });

  it("surfaces OMC's false as an unsuccessful call", async () => {
    const { ctx } = fakeCtx("false");
    expect(await setModelicaPath(ctx, { modelicaPath: "/nope" })).toEqual({
      success: false,
    });
  });
});
