/**
 * `invoke()` parses its input against the function's schema; a method that
 * reaches its wrapper directly does not, and the wrapper is where an argument
 * becomes command text. The two spellings sit one line apart in `client.ts`
 * and nothing in the types tells them apart, so the source is read back.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { OmcClient } from "./client.js";
import { runQueued, withErrorBuffer } from "./error-buffer.js";

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), "client.ts");

/**
 * `return <ns>.<fn>(this…)` — a wrapper reached without `invoke`.
 *
 * Match the call, not the method signature around it: a default parameter, an
 * overload and a renamed argument each change the signature without changing
 * what the method does.
 */
const DELEGATES_DIRECTLY = /\n\s*return (\w+)\.(\w+)\(this[,)]/g;

describe("every OmcClient method taking an input", () => {
  it("reaches its wrapper through invoke, so the schema cannot be skipped", async () => {
    const src = await readFile(CLIENT, "utf8");

    const bypassing = [...src.matchAll(DELEGATES_DIRECTLY)].map(
      (m) => `${m[1]}.${m[2]}`,
    );

    expect(bypassing).toEqual([]);
  });
});

describe("OmcClient's error-buffer readers", () => {
  it("wait for a held turn, whichever spelling reaches them", async () => {
    const client = Object.create(OmcClient.prototype) as OmcClient;
    let buffer = "";
    client.call = async (cmd: string) => {
      if (!cmd.startsWith("getErrorString")) return "true";
      const reply = JSON.stringify(buffer);
      buffer = "";
      return reply;
    };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached: () => void = () => undefined;
    const reachedGate = new Promise<void>((resolve) => {
      reached = resolve;
    });

    const turn = runQueued(client, async () => {
      buffer = "Error: queued mutation";
      reached();
      await gate;
      return (await client.invoke("getErrorString", {})).errorString;
    });
    await reachedGate;
    const viaMethod = client.getErrorString();
    const viaInvoke = client.invoke("getErrorString", {});
    release();

    expect(await turn).toBe("Error: queued mutation");
    expect(await viaMethod).toEqual({ errorString: "" });
    expect(await viaInvoke).toEqual({ errorString: "" });
  });

  it("surface a bare mutation's diagnostic on the mutation, not on a turn it overlaps", async () => {
    const client = Object.create(OmcClient.prototype) as OmcClient;
    let buffer = "";
    client.call = async (cmd: string) => {
      if (cmd.startsWith("getErrorString")) {
        const reply = JSON.stringify(buffer);
        buffer = "";
        return reply;
      }
      buffer = "Error: bare delete failed";
      return "false";
    };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached: () => void = () => undefined;
    const reachedGate = new Promise<void>((resolve) => {
      reached = resolve;
    });

    const turn = withErrorBuffer(client, async () => {
      reached();
      await gate;
    });
    await reachedGate;
    const bare = client.deleteClass({ typeName: "A" });
    release();

    await expect(bare).rejects.toThrow("bare delete failed");
    expect((await turn).errorString).toBe("");
  });
});
