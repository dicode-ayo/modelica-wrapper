import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  applyModelicaPath,
  onModelicaPathChanged,
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

  it("reads a leading ~ as the home directory, not a folder-relative name", () => {
    expect(
      resolveModelicaPathEntries([
        ws("/ws", "~/libs", "~"),
        { folder: undefined, entries: ["~/other"] },
      ]),
    ).toEqual([
      path.join(os.homedir(), "libs"),
      os.homedir(),
      path.join(os.homedir(), "other"),
    ]);
  });

  it("keeps a ~ that does not start the entry as part of a relative name", () => {
    expect(resolveModelicaPathEntries([ws("/ws", "~user/libs")])).toEqual([
      "/ws/~user/libs",
    ]);
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

describe("onModelicaPathChanged", () => {
  const touches = (section: string) => ({
    affectsConfiguration: (s: string) => s === section,
  });

  it("re-points a live session at the new entries, the installed default still last", async () => {
    const client = makeClient();
    await applyModelicaPath(client, [ws("/ws", "old")]);

    await onModelicaPathChanged(
      touches("modelica.modelicaPath"),
      Promise.resolve(client),
      () => [ws("/ws", "new")],
    );

    expect(client.setModelicaPath).toHaveBeenLastCalledWith({
      modelicaPath: ["/ws/new", ...INSTALLED].join(path.delimiter),
    });
  });

  it("restores the installed default when the setting is emptied", async () => {
    const client = makeClient();
    await applyModelicaPath(client, [ws("/ws", "old")]);

    await onModelicaPathChanged(
      touches("modelica.modelicaPath"),
      Promise.resolve(client),
      () => [ws("/ws")],
    );

    expect(client.setModelicaPath).toHaveBeenLastCalledWith({
      modelicaPath: INSTALLED.join(path.delimiter),
    });
  });

  it("reads nothing when no session is running, so it never spawns one", async () => {
    const scopes = vi.fn(() => [ws("/ws", "lib")]);
    await onModelicaPathChanged(
      touches("modelica.modelicaPath"),
      undefined,
      scopes,
    );
    expect(scopes).not.toHaveBeenCalled();
  });

  it("applies an edit made mid-spawn once the spawn settles, overriding what the spawn read", async () => {
    const client = makeClient();
    let setting = [ws("/ws", "old")];
    let resolveSpawn: (c: typeof client) => void = () => {};
    const spawn = new Promise<typeof client>((resolve) => {
      resolveSpawn = resolve;
    }).then(async (c) => {
      await applyModelicaPath(c, [ws("/ws", "old")]);
      return c;
    });

    setting = [ws("/ws", "new")];
    const change = onModelicaPathChanged(
      touches("modelica.modelicaPath"),
      spawn,
      () => setting,
    );
    resolveSpawn(client);
    await change;

    expect(client.setModelicaPath).toHaveBeenLastCalledWith({
      modelicaPath: ["/ws/new", ...INSTALLED].join(path.delimiter),
    });
  });

  it("reads the setting only after the spawn settles", async () => {
    const client = makeClient();
    let resolveSpawn: (c: typeof client) => void = () => {};
    const spawn = new Promise<typeof client>((resolve) => {
      resolveSpawn = resolve;
    });
    const scopes = vi.fn(() => [ws("/ws", "lib")]);

    const change = onModelicaPathChanged(
      touches("modelica.modelicaPath"),
      spawn,
      scopes,
    );
    await Promise.resolve();
    expect(scopes).not.toHaveBeenCalled();
    resolveSpawn(client);
    await change;
    expect(scopes).toHaveBeenCalledTimes(1);
  });

  it("settles quietly when the spawn it waited on fails", async () => {
    const scopes = vi.fn(() => [ws("/ws", "lib")]);
    await expect(
      onModelicaPathChanged(
        touches("modelica.modelicaPath"),
        Promise.reject(new Error("omc not found")),
        scopes,
      ),
    ).resolves.toBeUndefined();
    expect(scopes).not.toHaveBeenCalled();
  });

  it("ignores a change to another setting", async () => {
    const client = makeClient();
    await onModelicaPathChanged(
      touches("modelica.omcPath"),
      Promise.resolve(client),
      () => [ws("/ws", "lib")],
    );
    expect(client.getModelicaPath).not.toHaveBeenCalled();
    expect(client.setModelicaPath).not.toHaveBeenCalled();
  });
});
