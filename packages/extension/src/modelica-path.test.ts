import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  applyModelicaPath,
  resolveModelicaPathEntries,
  type ModelicaPathScope,
} from "./modelica-path.js";
import { systemLibraryVerdict } from "./system-library.js";

const INSTALLED = ["/home/u/.openmodelica/libraries", "/usr/lib/omlibrary"];

/** A client whose path starts at {@link INSTALLED} and follows each set. */
function makeClient(initial = INSTALLED.join(path.delimiter)) {
  let modelicaPath = initial;
  return {
    getModelicaPath: vi.fn(async () => ({ modelicaPath })),
    setModelicaPath: vi.fn(async (input: { modelicaPath: string }) => {
      modelicaPath = input.modelicaPath;
      return { success: true };
    }),
    getSourceFile: vi.fn(async () => ({ fileName: "" })),
  };
}

const ws = (folder: string, ...entries: string[]): ModelicaPathScope => ({
  folder,
  entries,
});

describe("resolveModelicaPathEntries", () => {
  it("resolves a relative entry against every folder that sees it", () => {
    expect(
      resolveModelicaPathEntries([ws("/ws/a", "lib"), ws("/ws/b", "lib")]),
    ).toEqual(["/ws/a/lib", "/ws/b/lib"]);
  });

  it("keeps an absolute entry as written, once across folders", () => {
    expect(
      resolveModelicaPathEntries([
        ws("/ws/a", "/opt/libs"),
        ws("/ws/b", "/opt/libs"),
      ]),
    ).toEqual(["/opt/libs"]);
  });

  it("keeps the order the folders and their entries come in", () => {
    expect(
      resolveModelicaPathEntries([
        ws("/ws/a", "x", "/opt/y"),
        ws("/ws/b", "z"),
      ]),
    ).toEqual(["/ws/a/x", "/opt/y", "/ws/b/z"]);
  });

  it("drops a relative entry when no folder is open, and blank entries always", () => {
    expect(
      resolveModelicaPathEntries([
        { folder: undefined, entries: ["lib", "  ", "/opt/libs"] },
      ]),
    ).toEqual(["/opt/libs"]);
  });
});

describe("applyModelicaPath", () => {
  it("puts the user's entries first and the installed default last, so they cannot shadow it", async () => {
    const client = makeClient();
    await applyModelicaPath(client, [ws("/ws/a", "lib"), ws("/ws/b", "lib")]);
    expect(client.setModelicaPath).toHaveBeenCalledWith({
      modelicaPath: ["/ws/a/lib", "/ws/b/lib", ...INSTALLED].join(
        path.delimiter,
      ),
    });
  });

  it("joins with the platform delimiter, the only separator OMC splits on", async () => {
    const client = makeClient();
    await applyModelicaPath(client, [ws("/ws", "/opt/libs")]);
    const [call] = client.setModelicaPath.mock.calls;
    expect(call?.[0].modelicaPath.split(path.delimiter)).toEqual([
      "/opt/libs",
      ...INSTALLED,
    ]);
  });

  it("leaves the path alone when the setting is empty", async () => {
    const client = makeClient();
    await applyModelicaPath(client, [ws("/ws")]);
    expect(client.setModelicaPath).not.toHaveBeenCalled();
  });

  it("does not throw when OMC cannot be read", async () => {
    const client = makeClient();
    client.getModelicaPath.mockRejectedValueOnce(new Error("omc gone"));
    await expect(
      applyModelicaPath(client, [ws("/ws", "lib")]),
    ).resolves.toBeUndefined();
    expect(client.setModelicaPath).not.toHaveBeenCalled();
  });

  it("does not throw when the set fails", async () => {
    const client = makeClient();
    client.setModelicaPath.mockRejectedValueOnce(new Error("omc gone"));
    await expect(
      applyModelicaPath(client, [ws("/ws", "lib")]),
    ).resolves.toBeUndefined();
  });

  it("does not stack the user's entries when applied again to the same session", async () => {
    const client = makeClient();
    await applyModelicaPath(client, [ws("/ws", "lib")]);
    await applyModelicaPath(client, [ws("/ws", "lib")]);
    expect(client.setModelicaPath).toHaveBeenLastCalledWith({
      modelicaPath: ["/ws/lib", ...INSTALLED].join(path.delimiter),
    });
  });

  it("leaves a class under a user entry editable, while the installed default stays read-only", async () => {
    const client = makeClient();
    await applyModelicaPath(client, [ws("/ws", "lib")]);

    client.getSourceFile.mockResolvedValueOnce({
      fileName: "/ws/lib/MyLib/package.mo",
    });
    expect(await systemLibraryVerdict(client, "MyLib")).toBe(false);

    client.getSourceFile.mockResolvedValueOnce({
      fileName: "/usr/lib/omlibrary/Modelica 4.0.0/package.mo",
    });
    expect(await systemLibraryVerdict(client, "Modelica")).toBe(true);
  });
});
