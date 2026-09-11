import { describe, expect, it } from "vitest";

import { clientConfigDocument } from "./client-config.js";

const ENDPOINT = {
  url: "http://127.0.0.1:54321/mcp",
  token: "6f1e-token",
};

describe("clientConfigDocument", () => {
  it("carries the address in both forms a client might take", () => {
    const doc = clientConfigDocument(ENDPOINT);

    expect(doc).toContain(
      `claude mcp add --transport http modelica ${ENDPOINT.url}`,
    );
    expect(doc).toContain(`"url": "${ENDPOINT.url}"`);
  });

  it("carries the token in the header both forms send", () => {
    const doc = clientConfigDocument(ENDPOINT);

    expect(doc).toContain(`Authorization: Bearer ${ENDPOINT.token}`);
    expect(doc).toContain(`"Authorization": "Bearer ${ENDPOINT.token}"`);
  });

  it("says the address goes stale, next to the address", () => {
    // The port and token are new on every start, so a config copied once and
    // kept is the failure this document exists to pre-empt.
    const [first] = clientConfigDocument(ENDPOINT).split("\n");

    expect(first).toContain("until the server restarts");
  });

  it("parses as JSON once the comments are stripped", () => {
    const doc = clientConfigDocument(ENDPOINT);
    const json = doc
      .split("\n")
      .filter((line) => !line.startsWith("//"))
      .join("\n");

    expect(JSON.parse(json)).toEqual({
      mcpServers: {
        modelica: {
          type: "http",
          url: ENDPOINT.url,
          headers: { Authorization: `Bearer ${ENDPOINT.token}` },
        },
      },
    });
  });
});
