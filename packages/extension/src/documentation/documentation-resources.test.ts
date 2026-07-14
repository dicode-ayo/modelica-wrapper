/**
 * `resolveDocResources` turns the `modelica://` image URIs in a documentation
 * string into `data:` URIs the webview can render. These pin: only image `src`s
 * that need resolving are looked up, a resolved file becomes a typed `data:`
 * URI, and an unresolvable URI is omitted (its `<img>` stays broken rather than
 * blocking the render).
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  resolveDocResources,
  type UriResolveClient,
} from "./documentation-resources.js";

// A 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function tempPng(): string {
  const dir = mkdtempSync(join(tmpdir(), "om-doc-res-"));
  const file = join(dir, "logo.png");
  writeFileSync(file, PNG);
  return file;
}

const URI = "modelica://Modelica/Resources/Images/Logo.png";

describe("resolveDocResources", () => {
  it("resolves a modelica:// image to a data: URI", async () => {
    const file = tempPng();
    const client: UriResolveClient = {
      uriToFilename: vi.fn(() => Promise.resolve({ filename: file })),
    };
    const info = `<html><p><img src="${URI}" alt="Logo"></p></html>`;

    const map = await resolveDocResources(client, info);

    expect(map[URI]).toMatch(/^data:image\/png;base64,/);
    expect(map[URI]).toContain(PNG.toString("base64"));
  });

  it("ignores non-resolving/data-src srcs and dedupes the rest", async () => {
    const uriToFilename = vi.fn(() => Promise.resolve({ filename: tempPng() }));
    const client: UriResolveClient = { uriToFilename };
    const info = `
      <img src="${URI}">
      <img src="${URI}">
      <img src="https://example.com/x.png">
      <img data-src="${URI}">
      <img src="data:image/png;base64,AAAA">`;

    await resolveDocResources(client, info);

    // Only the real modelica:// src is resolved, once — not the data-src.
    expect(uriToFilename).toHaveBeenCalledTimes(1);
    expect(uriToFilename).toHaveBeenCalledWith({ uri: URI });
  });

  it("resolves a file:// image too", async () => {
    const file = tempPng();
    const client: UriResolveClient = {
      uriToFilename: vi.fn(() => Promise.resolve({ filename: file })),
    };
    const src = "file:///some/logo.png";
    const map = await resolveDocResources(client, `<img src="${src}">`);
    expect(map[src]).toMatch(/^data:image\/png;base64,/);
  });

  it("omits an unresolvable URI (empty filename)", async () => {
    const client: UriResolveClient = {
      uriToFilename: vi.fn(() => Promise.resolve({ filename: "" })),
    };
    const map = await resolveDocResources(client, `<img src="${URI}">`);
    expect(map[URI]).toBeUndefined();
  });

  it("keeps resolving other images when one URI rejects", async () => {
    const ok = "modelica://Modelica/Resources/Images/Ok.png";
    const file = tempPng();
    const client: UriResolveClient = {
      uriToFilename: vi.fn((a: { uri: string }) =>
        a.uri === URI
          ? Promise.reject(new Error("channel error"))
          : Promise.resolve({ filename: file }),
      ),
    };
    const map = await resolveDocResources(
      client,
      `<img src="${URI}"><img src="${ok}">`,
    );
    expect(map[URI]).toBeUndefined();
    expect(map[ok]).toMatch(/^data:image\/png;base64,/);
  });
});
