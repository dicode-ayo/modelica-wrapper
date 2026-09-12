/**
 * The source tree handed to the MCP tools is read per access.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { afterEach, expect, it } from "vitest";

import { setWorkspaceFolders } from "../../test-support/vscode-mock.js";

import { mcpToolDeps } from "./index.js";

const base = {
  ensureClient: () => Promise.reject(new Error("not used")),
  verdicts: { forClass: () => Promise.resolve({ ok: true as const }) },
};
const writer = { write: () => Promise.resolve() };

afterEach(() => {
  setWorkspaceFolders([]);
});

it("follows a workspace folder opened after the server was built", () => {
  const deps = mcpToolDeps(base, writer);

  setWorkspaceFolders([]);
  const before = deps.workspace;
  setWorkspaceFolders(["/ws/one"]);
  const opened = deps.workspace;
  setWorkspaceFolders(["/ws/two"]);
  const replaced = deps.workspace;

  // A folder added or removed mid-session does not restart the extension
  // host, so a tree captured when the provider registered would be stale.
  expect(before).toBeUndefined();
  expect(opened).toEqual({ root: "/ws/one", writer });
  expect(replaced).toEqual({ root: "/ws/two", writer });
});
