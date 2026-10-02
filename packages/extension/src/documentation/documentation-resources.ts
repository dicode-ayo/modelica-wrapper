import { promises as fsp } from "node:fs";
import * as path from "node:path";

import type { ParameterModel } from "@dicode/omc-client";

import { errorDetail } from "../error-detail.js";
import { log } from "../logger.js";

/** The subset of OMC used to resolve resource URIs. */
export interface UriResolveClient {
  uriToFilename(input: { uri: string }): Promise<{ filename: string }>;
}

/** Map of an original image `src` (e.g. `modelica://…`) → a loadable `data:` URI. */
export type ResourceMap = Record<string, string>;

// `\ssrc` (not `\bsrc`) so `data-src` — where `-` is a word boundary — isn't
// captured as if it were a real `src`.
const IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
};

/** `src` values a webview can't load itself and that OMC can resolve to a file. */
function needsResolving(src: string): boolean {
  return /^modelica:\/\//i.test(src) || /^file:\/\//i.test(src);
}

/** Every distinct `<img>` src in `info` that needs host resolution. */
function imageUrisIn(info: string): string[] {
  const seen = new Set<string>();
  for (const m of info.matchAll(IMG_SRC)) {
    const src = m[1];
    if (src !== undefined && needsResolving(src)) seen.add(src);
  }
  return [...seen];
}

async function fileToDataUri(filename: string): Promise<string | undefined> {
  const mime = MIME_BY_EXT[path.extname(filename).toLowerCase()];
  if (mime === undefined) return undefined;
  try {
    const bytes = await fsp.readFile(filename);
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch (err) {
    log.warn(
      "documentationResources",
      `read ${filename} failed: ${errorDetail(err)}`,
    );
    return undefined;
  }
}

/**
 * Resolve one `modelica://` / `file://` URI to an inlined `data:` URI. Returns
 * `undefined` for an unresolvable URI, an unknown image type, or an OMC
 * failure, so a single broken image never blocks the surrounding render.
 */
export async function resolveImageUri(
  client: UriResolveClient,
  uri: string,
): Promise<string | undefined> {
  try {
    const { filename } = await client.uriToFilename({ uri });
    if (filename.length === 0) return undefined;
    return await fileToDataUri(filename);
  } catch (err) {
    log.warn(
      "documentationResources",
      `resolve ${uri} failed: ${errorDetail(err)}`,
    );
    return undefined;
  }
}

/**
 * Resolve every `modelica://` / `file://` image `src` in a `Documentation(info)`
 * string to an inlined `data:` URI the webview can render. `modelica://` URIs
 * only resolve when the referenced class is loaded; an unresolvable URI (or an
 * unknown image type) is simply omitted, so its `<img>` stays broken rather than
 * blocking the render. The annotation's `src` is never rewritten — only the
 * display layer swaps in the resolved URI, so the source keeps `modelica://`.
 */
export async function resolveDocResources(
  client: UriResolveClient,
  info: string,
): Promise<ResourceMap> {
  const out: ResourceMap = {};
  for (const uri of imageUrisIn(info)) {
    const dataUri = await resolveImageUri(client, uri);
    if (dataUri !== undefined) out[uri] = dataUri;
  }
  return out;
}

/**
 * Resolve each distinct `Dialog(groupImage)` URI on a parameter model to a
 * `data:` URI through the documentation resolver. A field whose image cannot be
 * resolved loses `groupImage`, so the webview only ever sees loadable URIs.
 * Returns the input untouched when no field carries one.
 */
export async function resolveGroupImages(
  client: UriResolveClient,
  model: ParameterModel,
): Promise<ParameterModel> {
  const uris = new Set<string>();
  for (const f of model.fields) {
    if (f.dialog.groupImage !== undefined) uris.add(f.dialog.groupImage);
  }
  if (uris.size === 0) return model;
  const resolved = new Map<string, string | undefined>();
  for (const uri of uris) resolved.set(uri, await resolveImageUri(client, uri));
  return {
    ...model,
    fields: model.fields.map((f) => {
      const uri = f.dialog.groupImage;
      if (uri === undefined) return f;
      const { groupImage: _drop, ...dialog } = f.dialog;
      const dataUri = resolved.get(uri);
      return {
        ...f,
        dialog:
          dataUri === undefined ? dialog : { ...dialog, groupImage: dataUri },
      };
    }),
  };
}
