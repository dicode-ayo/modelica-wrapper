/**
 * `DocumentationHtmlProvider` serves a class's `Documentation(info=…)` as an
 * editable `modelica-doc:` file. These pin the contracts: a read renders the
 * current annotation, a write sends the new `info` through
 * `setFullDocumentationAnnotation` and reflects into the class's `.mo`, and a
 * read-only source refuses writes. Preserving `revisions`/`infoHeader` on
 * write is `setFullDocumentationAnnotation`'s own contract, pinned in
 * omc-client's tests, not this provider's.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
  DocumentationHtmlProvider,
  docHtmlUriFor,
  type DocHtmlClient,
} from "./documentation-html-provider.js";

interface Calls {
  setArgs: { typeName: string; info: string }[];
}

function makeClient(
  anno: { info?: string; fail?: boolean },
  opts?: { fileReadOnly?: boolean; setOk?: boolean; systemLib?: boolean },
): { client: DocHtmlClient; calls: Calls } {
  const calls: Calls = { setArgs: [] };
  const sourceFile = opts?.systemLib
    ? "/home/u/.openmodelica/libraries/Modelica/Blocks/package.mo"
    : "/ws/Pkg/M.mo";
  const client: DocHtmlClient = {
    getDocumentationAnnotation: vi.fn(() =>
      anno.fail
        ? Promise.reject(new Error("OMC down"))
        : Promise.resolve({ info: anno.info ?? "" }),
    ),
    getClassInformation: vi.fn(() =>
      Promise.resolve({ fileReadOnly: opts?.fileReadOnly ?? false }),
    ),
    getSourceFile: vi.fn(() => Promise.resolve({ fileName: sourceFile })),
    getModelicaPath: vi.fn(() =>
      Promise.resolve({ modelicaPath: "/home/u/.openmodelica/libraries" }),
    ),
    setFullDocumentationAnnotation: vi.fn(
      (a: { typeName: string; info: string }) => {
        calls.setArgs.push(a);
        return Promise.resolve({ success: opts?.setOk ?? true });
      },
    ),
  };
  return { client, calls };
}

const CLASS = "Pkg.M";
const URI = docHtmlUriFor(CLASS);

describe("DocumentationHtmlProvider", () => {
  it("reads the class's info HTML", async () => {
    const { client } = makeClient({ info: "<html><p>hi</p></html>" });
    const provider = new DocumentationHtmlProvider(
      () => Promise.resolve(client),
      () => {},
    );
    const bytes = await provider.readFile(URI);
    expect(Buffer.from(bytes).toString("utf8")).toBe("<html><p>hi</p></html>");
  });

  it("fails the read on OMC error instead of serving empty (a save would wipe)", async () => {
    const { client } = makeClient({ fail: true });
    const provider = new DocumentationHtmlProvider(
      () => Promise.resolve(client),
      () => {},
    );
    await expect(provider.readFile(URI)).rejects.toThrow();
  });

  it("writes the new info, then notifies the class", async () => {
    const notified: string[] = [];
    const { client, calls } = makeClient({ info: "<html><p>old</p></html>" });
    const provider = new DocumentationHtmlProvider(
      () => Promise.resolve(client),
      (name) => notified.push(name),
    );

    await provider.writeFile(URI, Buffer.from("<html><p>new</p></html>"));

    expect(calls.setArgs).toEqual([
      { typeName: CLASS, info: "<html><p>new</p></html>" },
    ]);
    expect(notified).toEqual([CLASS]);
  });

  it("refuses to write a read-only source", async () => {
    const { client, calls } = makeClient(
      { info: "<html></html>" },
      { fileReadOnly: true },
    );
    const provider = new DocumentationHtmlProvider(
      () => Promise.resolve(client),
      () => {},
    );
    await expect(
      provider.writeFile(URI, Buffer.from("<html><p>x</p></html>")),
    ).rejects.toMatchObject({ code: "NoPermissions" });
    expect(calls.setArgs).toEqual([]);
  });

  it("refuses to write a system-library class whose file is writable", async () => {
    const { client, calls } = makeClient(
      { info: "<html></html>" },
      { systemLib: true },
    );
    const provider = new DocumentationHtmlProvider(
      () => Promise.resolve(client),
      () => {},
    );
    await expect(
      provider.writeFile(URI, Buffer.from("<html><p>x</p></html>")),
    ).rejects.toMatchObject({ code: "NoPermissions" });
    expect(calls.setArgs).toEqual([]);
  });

  it("fires a change event when the class's .mo changed elsewhere", () => {
    const { client } = makeClient({ info: "<html></html>" });
    const provider = new DocumentationHtmlProvider(
      () => Promise.resolve(client),
      () => {},
    );
    const fired: vscode.Uri[] = [];
    provider.onDidChangeFile((events) => {
      for (const e of events) fired.push(e.uri);
    });
    provider.refreshFromClass(CLASS);
    expect(fired.map((u) => u.toString())).toContain(URI.toString());
  });
});
