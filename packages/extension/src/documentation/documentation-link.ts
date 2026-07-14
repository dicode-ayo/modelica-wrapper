import * as vscode from "vscode";

import { DOCUMENTATION_VIEW_TYPE } from "../diagram/view-type.js";
import { errorDetail } from "../error-detail.js";
import { sourceUriFor } from "../source-provider.js";

/** The subset of OMC used to resolve a resource link. */
interface LinkClient {
  uriToFilename(input: { uri: string }): Promise<{ filename: string }>;
}

/**
 * A `modelica://` link target: a dotted class name (a cross-reference), or a
 * resource path (contains a `/`, e.g. `Foo/Resources/doc.pdf`).
 */
export type ModelicaLink =
  | { kind: "class"; className: string }
  | { kind: "resource"; uri: string };

/**
 * Classify a `modelica://` href. A path segment (`/`) marks a resource; anything
 * else is a dotted class reference (a trailing `#…`/`?…` is dropped). Returns
 * null for a non-`modelica://` or empty href.
 */
export function parseModelicaLink(href: string): ModelicaLink | null {
  const m = /^\s*modelica:\/\/(.+?)\s*$/i.exec(href);
  if (!m) return null;
  // Drop a trailing in-document anchor / query — MSL UsersGuide links use them.
  const rest = (m[1] ?? "").split(/[#?]/)[0] ?? "";
  if (rest.length === 0) return null;
  if (rest.includes("/"))
    return { kind: "resource", uri: `modelica://${rest}` };
  return { kind: "class", className: rest };
}

/**
 * Follow a `modelica://` link: open the target class's documentation, or a
 * referenced resource file (resolved through OMC). Unresolvable or malformed
 * targets surface a message rather than throwing.
 */
export async function openModelicaLink(
  href: string,
  ensureClient: () => Promise<LinkClient>,
): Promise<void> {
  const parsed = parseModelicaLink(href);
  if (parsed === null) return;
  try {
    if (parsed.kind === "class") {
      await vscode.commands.executeCommand(
        "vscode.openWith",
        sourceUriFor(parsed.className),
        DOCUMENTATION_VIEW_TYPE,
      );
      return;
    }
    const client = await ensureClient();
    const { filename } = await client.uriToFilename({ uri: parsed.uri });
    if (filename.length === 0) {
      await vscode.window.showWarningMessage(
        `Modelica: couldn't resolve the link ${href}`,
      );
      return;
    }
    await vscode.commands.executeCommand(
      "vscode.open",
      vscode.Uri.file(filename),
    );
  } catch (err) {
    await vscode.window.showErrorMessage(
      `Modelica: couldn't open ${href}: ${errorDetail(err)}`,
    );
  }
}
