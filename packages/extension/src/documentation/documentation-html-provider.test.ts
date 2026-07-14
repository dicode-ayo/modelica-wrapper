/**
 * `DocumentationHtmlProvider` serves a class's `Documentation(info=…)` as an
 * editable `modelica-doc:` file. These pin the contracts: a read renders the
 * current annotation, a write carries the current `revisions` back (so that
 * section isn't cleared) and reflects into the class's `.mo`, and a read-only
 * source or an `__OpenModelica_infoHeader`-bearing class refuses writes.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type { OmcClient } from "@dicode/omc-client";

import {
  DocumentationHtmlProvider,
  docHtmlUriFor,
} from "./documentation-html-provider.js";

interface Calls {
  setArgs: { typeName: string; info: string; revisions: string }[];
}

function makeClient(
  anno: { info?: string; revision?: string; infoHeader?: string },
  opts?: { fileReadOnly?: boolean; setOk?: boolean },
): { client: OmcClient; calls: Calls } {
  const calls: Calls = { setArgs: [] };
  const client = {
    getDocumentationAnnotation: vi.fn(() =>
      Promise.resolve({
        info: anno.info ?? "",
        revision: anno.revision ?? "",
        infoHeader: anno.infoHeader ?? "",
      }),
    ),
    getClassInformation: vi.fn(() =>
      Promise.resolve({ fileReadOnly: opts?.fileReadOnly ?? false }),
    ),
    setDocumentationAnnotation: vi.fn(
      (a: { typeName: string; info: string; revisions: string }) => {
        calls.setArgs.push(a);
        return Promise.resolve({ bool: opts?.setOk ?? true });
      },
    ),
  } as unknown as OmcClient;
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

  it("refuses to write a class carrying an infoHeader", async () => {
    const { client, calls } = makeClient({
      info: "<html></html>",
      infoHeader: "<html><p>header</p></html>",
    });
    const provider = new DocumentationHtmlProvider(
      () => Promise.resolve(client),
      () => {},
    );
    await expect(
      provider.writeFile(URI, Buffer.from("<html><p>x</p></html>")),
    ).rejects.toThrow();
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
