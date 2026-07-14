import { promises as fsp } from "node:fs";
import * as path from "node:path";

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
    try {
      const { filename } = await client.uriToFilename({ uri });
      if (filename.length === 0) continue;
      const dataUri = await fileToDataUri(filename);
      if (dataUri !== undefined) out[uri] = dataUri;
    } catch (err) {
      // One broken image must not take the whole (already-fetched) doc down.
      log.warn(
        "documentationResources",
        `resolve ${uri} failed: ${errorDetail(err)}`,
      );
    }
  }
  return out;
}
