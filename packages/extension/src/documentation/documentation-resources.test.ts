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

import type { ParameterModel } from "@dicode/omc-client";

import {
  resolveDocResources,
  resolveGroupImages,
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

describe("resolveGroupImages", () => {
  function modelWith(images: Array<string | undefined>): ParameterModel {
    return {
      className: "M",
      fields: images.map((groupImage, i) => ({
        name: `p${i}`,
        label: `p${i}`,
        kind: "number" as const,
        value: 1,
        dialog: { tab: "General", group: "G", groupImage },
        unitOptions: [],
      })),
    };
  }

  it("replaces a modelica:// groupImage with an inlined data: URI, resolving each URI once", async () => {
    const file = tempPng();
    const uriToFilename = vi.fn(() => Promise.resolve({ filename: file }));
    const out = await resolveGroupImages(
      { uriToFilename },
      modelWith([URI, URI, undefined]),
    );
    expect(uriToFilename).toHaveBeenCalledTimes(1);
    expect(out.fields[0]?.dialog.groupImage).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(out.fields[1]?.dialog.groupImage).toBe(
      out.fields[0]?.dialog.groupImage,
    );
    expect(out.fields[2]?.dialog.groupImage).toBeUndefined();
  });

  it("drops an unresolvable groupImage instead of throwing", async () => {
    const out = await resolveGroupImages(
      { uriToFilename: vi.fn(() => Promise.reject(new Error("boom"))) },
      modelWith([URI]),
    );
    expect("groupImage" in (out.fields[0]?.dialog ?? {})).toBe(false);
  });

  it("returns the model untouched when no field carries an image", async () => {
    const uriToFilename = vi.fn();
    const model = modelWith([undefined]);
    expect(await resolveGroupImages({ uriToFilename }, model)).toBe(model);
    expect(uriToFilename).not.toHaveBeenCalled();
  });
});
