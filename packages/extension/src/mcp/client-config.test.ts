import { describe, expect, it } from "vitest";

import { claudeAddCommand, mergedClientConfig } from "./client-config.js";

const ENDPOINT = {
  url: "http://127.0.0.1:54321/mcp",
  token: "6f1e-token",
};

const ENTRY = {
  type: "http",
  url: ENDPOINT.url,
  headers: { Authorization: `Bearer ${ENDPOINT.token}` },
};

/** The merged text, parsed back. */
function merged(existing: string | undefined): unknown {
  const text = mergedClientConfig(existing, ENDPOINT);
  if (text === undefined) throw new Error("config was refused");
  return JSON.parse(text);
}

describe("mergedClientConfig", () => {
  it("writes the entry into a file that does not exist yet", () => {
    expect(merged(undefined)).toEqual({ mcpServers: { modelica: ENTRY } });
  });

  it("keeps the servers already configured", () => {
    // `.mcp.json` is where a project's other servers live; rewriting the file
    // wholesale would take them with it.
    const existing = JSON.stringify({
      mcpServers: { playwright: { command: "npx", args: ["playwright"] } },
    });

    expect(merged(existing)).toEqual({
      mcpServers: {
        playwright: { command: "npx", args: ["playwright"] },
        modelica: ENTRY,
      },
    });
  });

  it("keeps keys that are not servers at all", () => {
    expect(merged(JSON.stringify({ someOtherTool: { a: 1 } }))).toMatchObject({
      someOtherTool: { a: 1 },
    });
  });

  it("replaces a stale entry rather than adding a second", () => {
    const stale = JSON.stringify({
      mcpServers: {
        modelica: { type: "http", url: "http://127.0.0.1:1/mcp", headers: {} },
      },
    });

    expect(merged(stale)).toEqual({ mcpServers: { modelica: ENTRY } });
  });

  it("treats an empty file as absent", () => {
    expect(merged("   \n")).toEqual({ mcpServers: { modelica: ENTRY } });
  });

  it("refuses a file that is not a JSON object", () => {
    expect(mergedClientConfig("[1, 2]", ENDPOINT)).toBeUndefined();
  });

  it("lets malformed JSON throw rather than clobbering it", () => {
    expect(() => mergedClientConfig("{oops", ENDPOINT)).toThrow();
  });
});

describe("claudeAddCommand", () => {
  it("carries the address and the token the server will demand", () => {
    expect(claudeAddCommand(ENDPOINT)).toBe(
      `claude mcp add --transport http modelica ${ENDPOINT.url} ` +
        `--header "Authorization: Bearer ${ENDPOINT.token}"`,
    );
  });
});
