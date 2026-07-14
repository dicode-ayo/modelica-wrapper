/**
 * `DocumentationHtmlProvider` serves a class's `Documentation(info=…)` as an
 * editable `modelica-doc:` file. These pin the contracts: a read renders the
 * current annotation, a write carries the current `revisions` and
 * `infoHeader` back (so neither section is cleared) and reflects into the
 * class's `.mo`, and a read-only source refuses writes.
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
  setArgs: {
    typeName: string;
    info: string;
    revisions: string;
    infoHeader: string;
  }[];
}

function makeClient(
  anno: {
    info?: string;
    revision?: string;
    infoHeader?: string;
    fail?: boolean;
  },
  opts?: { fileReadOnly?: boolean; setOk?: boolean },
): { client: DocHtmlClient; calls: Calls } {
  const calls: Calls = { setArgs: [] };
  const client: DocHtmlClient = {
    getDocumentationAnnotation: vi.fn(() =>
      anno.fail
        ? Promise.reject(new Error("OMC down"))
        : Promise.resolve({
            info: anno.info ?? "",
            revision: anno.revision ?? "",
            infoHeader: anno.infoHeader ?? "",
          }),
    ),
    getClassInformation: vi.fn(() =>
      Promise.resolve({ fileReadOnly: opts?.fileReadOnly ?? false }),
    ),
    setFullDocumentationAnnotation: vi.fn(
      (a: {
        typeName: string;
        info: string;
        revisions: string;
        infoHeader: string;
      }) => {
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

  it("writes carrying the current revisions, then notifies the class", async () => {
    const notified: string[] = [];
    const { client, calls } = makeClient({
      info: "<html><p>old</p></html>",
      revision: "<html><p>REV</p></html>",
    });
    const provider = new DocumentationHtmlProvider(
      () => Promise.resolve(client),
      (name) => notified.push(name),
    );

    await provider.writeFile(URI, Buffer.from("<html><p>new</p></html>"));

    expect(calls.setArgs).toEqual([
      {
        typeName: CLASS,
        info: "<html><p>new</p></html>",
        revisions: "<html><p>REV</p></html>",
        infoHeader: "",
      },
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
    ).rejects.toThrow();
    expect(calls.setArgs).toEqual([]);
  });

  it("carries the current infoHeader back on write, unchanged", async () => {
    // The load-bearing regression for #304: this class used to be refused
    // writes entirely because the old write path had no way to preserve
    // infoHeader. It now writes and passes the header back verbatim.
    const { client, calls } = makeClient({
      info: "<html></html>",
      infoHeader: "<html><p>header</p></html>",
    });
    const provider = new DocumentationHtmlProvider(
      () => Promise.resolve(client),
      () => {},
    );

    await provider.writeFile(URI, Buffer.from("<html><p>x</p></html>"));

    expect(calls.setArgs).toEqual([
      {
        typeName: CLASS,
        info: "<html><p>x</p></html>",
        revisions: "",
        infoHeader: "<html><p>header</p></html>",
      },
    ]);
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
