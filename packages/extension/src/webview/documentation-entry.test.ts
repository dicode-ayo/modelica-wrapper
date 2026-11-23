import type { DocumentationInterface } from "@dicode/documentation-ui/interface-model";
import { describe, expect, it } from "vitest";

import "./documentation-entry.js";
import type {
  DocExtensionToWebview,
  DocWebviewToExtension,
} from "./documentation-protocol.js";
import {
  installVsCodeApi,
  mountRoot,
  postFromHost,
  rendered,
} from "./vscode-api.fixture.js";

const host = installVsCodeApi<DocWebviewToExtension, DocExtensionToWebview>();

type Root = HTMLElementTagNameMap["om-documentation-root"];

const mount = () => mountRoot("om-documentation-root");
const editor = (root: Root) => rendered(root, "om-documentation-editor");

const DOC: DocExtensionToWebview = {
  type: "doc",
  className: "P.M",
  info: "<html><p>hi</p></html>",
  readOnly: true,
  resources: {},
};

const INTERFACE: DocumentationInterface = {
  extendsTree: [{ name: "P.Base", children: [] }],
  parameters: [],
  connectors: [],
};

describe("<om-documentation-root>", () => {
  it("posts ready once it is connected", async () => {
    await mount();
    expect(host.posted).toEqual([{ type: "ready" }]);
  });

  it("feeds a doc message into the editor", async () => {
    const root = await mount();
    await host.fromHost(root, DOC);
    expect(editor(root).info).toBe("<html><p>hi</p></html>");
    expect(editor(root).readOnly).toBe(true);
  });

  it("renders the interface only when it has a section, and drops it on reload", async () => {
    const root = await mount();
    await host.fromHost(root, DOC);
    await host.fromHost(root, {
      type: "interface",
      className: "P.M",
      interface: { extendsTree: [], parameters: [], connectors: [] },
    });
    expect(root.querySelector("om-documentation-interface")).toBeNull();

    await host.fromHost(root, {
      type: "interface",
      className: "P.M",
      interface: INTERFACE,
    });
    expect(root.querySelector("om-documentation-interface")?.model).toBe(
      INTERFACE,
    );

    await host.fromHost(root, DOC);
    expect(root.querySelector("om-documentation-interface")).toBeNull();
  });

  it("shows a host error until the next doc clears it", async () => {
    const root = await mount();
    const banner = () => root.querySelector<HTMLElement>(".om-doc-host-error");
    expect(banner()?.hidden).toBe(true);

    await host.fromHost(root, { type: "error", message: "write failed" });
    expect(banner()?.hidden).toBe(false);
    expect(banner()?.textContent).toContain("write failed");

    await host.fromHost(root, DOC);
    expect(banner()?.hidden).toBe(true);
  });

  it("ignores a message that is not a protocol object", async () => {
    const root = await mount();
    await host.fromHost(root, DOC);
    postFromHost("doc");
    postFromHost(null);
    await root.updateComplete;
    expect(editor(root).info).toBe(DOC.info);
  });

  it("relays the editor's edits, source requests and links to the host", async () => {
    const root = await mount();
    host.clear();
    const el = editor(root);
    el.dispatchEvent(
      new CustomEvent("om-documentation-change", {
        detail: { info: "<html>new</html>" },
      }),
    );
    el.dispatchEvent(new CustomEvent("om-documentation-edit-source"));
    el.dispatchEvent(
      new CustomEvent("om-documentation-open-link", {
        detail: { href: "modelica://P.Other" },
      }),
    );
    expect(host.posted).toEqual([
      { type: "edit", info: "<html>new</html>" },
      { type: "editSource" },
      { type: "openLink", href: "modelica://P.Other" },
    ]);
  });
});
