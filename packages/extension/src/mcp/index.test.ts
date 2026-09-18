/**
 * The source tree handed to the MCP tools is read per access.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { MAX_LOGGED_CHARS } from "@dicode/modelica-mcp";
import { afterEach, expect, it } from "vitest";

import {
  recordedMessages,
  setWorkspaceFolders,
} from "../../test-support/vscode-mock.js";

import { MAX_LINE_CHARS } from "../logger.js";

import { mcpToolDeps } from "./index.js";

const base = {
  ensureClient: () => Promise.reject(new Error("not used")),
  verdicts: { forClass: () => Promise.resolve({ ok: true as const }) },
};
const writer = { write: () => Promise.resolve() };

afterEach(() => {
  setWorkspaceFolders([]);
  recordedMessages.length = 0;
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

it("surfaces a dispatch failure as a VSCode error notification", () => {
  const deps = mcpToolDeps(base, writer);

  deps.notifyFailure?.("addComponent failed: already declared");

  expect(recordedMessages).toHaveLength(1);
  expect(recordedMessages[0]?.level).toBe("error");
  expect(recordedMessages[0]?.message).toContain("already declared");
});

it("does not override a notifyFailure the caller already wired", () => {
  const calls: string[] = [];
  const deps = mcpToolDeps(
    { ...base, notifyFailure: (m) => calls.push(m) },
    writer,
  );

  deps.notifyFailure?.("boom");

  expect(calls).toEqual(["boom"]);
  expect(recordedMessages).toEqual([]);
});

it("bounds a channel line above what one dispatch line can carry", () => {
  // `fn input -> output` caps each value at MAX_LOGGED_CHARS and appends an
  // overflow suffix to each. A sink bound that does not clear the pair drops
  // the result half of every line carrying a long argument.
  const GLUE_AND_SUFFIXES = 200;

  expect(MAX_LINE_CHARS).toBeGreaterThan(
    2 * MAX_LOGGED_CHARS + GLUE_AND_SUFFIXES,
  );
});
