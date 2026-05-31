/**
 * OMC: `function uriToFilename`
 *
 * Resolve a Modelica resource URI to an absolute on-disk path. Used to render
 * `Bitmap` shapes and group images that reference resources by URI
 * (`modelica://Modelica/Resources/Images/...`) — OMEdit resolves these at
 * icon/bitmap paint time (`OMCProxy::uriToFilename`, also via
 * `makeDocumentationUriToFileName`). Handles both `modelica://` and `file://`
 * URIs; `modelica://` URIs only resolve when the referenced class is loaded.
 *
 * ```modelica
 * function uriToFilename
 *   input String uri;
 *   output String filename = "";
 * end uriToFilename;
 * ```
 *
 * Verified live on OMC 1.26.7 (Modelica loaded):
 *   - `uriToFilename("modelica://Modelica/package.mo")`
 *       → `".../libraries/Modelica 4.0.0+maint.om/package.mo"`
 *   - `uriToFilename("modelica://Modelica/Resources/Images/Logos/Modelica.png")`
 *       → `".../libraries/Modelica 4.0.0+maint.om/Resources/Images/Logos/Modelica.png"`
 *
 * `uri` is a `String` arg and MUST be quoted — OMC otherwise tries to resolve
 * a bare ident as a name in scope (see audit.md §2.10). The OMC default for an
 * unresolvable URI is the empty string `""`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { quote } from "../../_shared/format.js";
import { asString, parse } from "../../parse.js";

export const UriToFilenameInputSchema = z.object({
  uri: z
    .string()
    .describe(
      'Resource URI to resolve (e.g. "modelica://Modelica/Resources/Images/...").',
    ),
});
export type UriToFilenameInput = z.input<typeof UriToFilenameInputSchema>;

export const UriToFilenameOutputSchema = z.object({
  filename: z
    .string()
    .describe(
      "Absolute filesystem path the URI resolves to; empty on failure.",
    ),
});
export type UriToFilenameOutput = z.infer<typeof UriToFilenameOutputSchema>;

export const UriToFilenameDescription =
  "Convert a modelica:// or file:// resource URI to an absolute filesystem path; empty string if it cannot be resolved.";

export async function uriToFilename(
  ctx: CallContext,
  input: UriToFilenameInput,
): Promise<UriToFilenameOutput> {
  const raw = await ctx.call(`uriToFilename(${quote(input.uri)})`);
  return parseOutput(
    UriToFilenameOutputSchema,
    { filename: asString(parse(raw)) ?? "" },
    "uriToFilename",
  );
}
