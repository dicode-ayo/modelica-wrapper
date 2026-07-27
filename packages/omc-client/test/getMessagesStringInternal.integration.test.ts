/**
 * Integration tests for the `getMessagesStringInternal` wrapper against a
 * real OMC. Auto-skips when no OMC is available.
 *
 * Three scenarios:
 *   1. Empty buffer → `messages: []`
 *   2. Syntax error injected via `loadString` of broken Modelica → 1 message,
 *      kind="syntax", level="error", positioned at the missing-semicolon line.
 *   3. Semantic error injected via `loadString` of a clean class + `checkModel`
 *      on an undefined-name → ≥1 message with semantic-level error.
 *
 * Gating mirrors `integration.test.ts`: `OMC_INTEGRATION=0` forces skip,
 * `OMC_INTEGRATION=1` forces run.
 */

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";
import { describeIf } from "./fixtures.js";

describeIf("getMessagesStringInternal against real OMC", () => {
  let client: OmcClient;

  beforeEach(async () => {
    client = await OmcClient.create({
      omcPath: process.env.OMC_PATH ?? "",
    });
    // Drain any stale buffer from OMC startup.
    await client.getErrorString();
  });

  afterEach(async () => {
    // Best-effort cleanup; ignore failures.
    for (const cls of ["MwMsgSyntax", "MwMsgSemantic", "MwMsgClean"]) {
      await client
        .invoke("deleteClass", { typeName: cls })
        .catch(() => undefined);
    }
    await client.close();
  });

  it("returns an empty array when the buffer is empty", async () => {
    const { messages } = await client.getMessagesStringInternal();
    expect(messages).toEqual([]);
  });

  it("returns a positioned syntax error when loadString hits a missing semicolon", async () => {
    // Broken Modelica: missing semicolon after `Real x = 1.0` on line 2 of the
    // body (line 3 of the file, columns 3-3 per probe verdict).
    const src = `model MwMsgSyntax
  Real x = 1.0
  Real y = 2.0;
equation
  y = x;
end MwMsgSyntax;`;

    // Trigger the syntax error. Don't read errorString first — that drains.
    await client.loadString({ data: src, filename: "mw-msg-syntax.mo" });

    const { messages } = await client.getMessagesStringInternal();
    expect(messages.length).toBeGreaterThan(0);
    const m = messages[0]!;
    expect(m.kind).toBe("syntax");
    expect(m.level).toBe("error");
    expect(m.info.filename).toBe("mw-msg-syntax.mo");
    expect(m.info.lineStart).toBe(3);
    expect(m.info.columnStart).toBe(3);
    expect(m.message).toMatch(/SEMICOLON|semicolon|;/i);
  });

  it("returns a semantic-level error when checkModel hits an undefined name", async () => {
    // Clean syntax, but the body references an undefined identifier so the
    // semantic check fails. checkModel surfaces these via the message buffer.
    const src = `model MwMsgSemantic
  Real x;
equation
  x = nonexistent_symbol;
end MwMsgSemantic;`;
    await client.loadString({ data: src, filename: "mw-msg-semantic.mo" });
    // loadString should succeed (no syntax errors). Drain any notification
    // messages it emitted so the semantic check is what we observe.
    await client.getErrorString();
    await client.checkModel({ typeName: "MwMsgSemantic" });

    const { messages } = await client.getMessagesStringInternal();
    expect(messages.length).toBeGreaterThan(0);
    // At least one diagnostic at error level (we don't pin the exact kind
    // because OMC may classify undefined-name as `scripting` or `translation`
    // depending on phase; the spec calls only for "semantic-level error").
    const errors = messages.filter((m) => m.level === "error");
    expect(errors.length).toBeGreaterThan(0);
  });
});
