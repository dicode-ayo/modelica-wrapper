/**
 * What `OmcClient` announces for a command, driven through its real `call()`
 * against a scripted transport.
 */

import { describe, expect, it, vi } from "vitest";

import { OmcClient } from "./client.js";
import type { OmcMutation } from "./mutation.js";
import { REGISTRY } from "./registry.js";

type Reply = (cmd: string) => string | Promise<string>;

/** A client whose transport answers each command with `reply`. */
function scriptedClient(reply: Reply): {
  client: OmcClient;
  announced: OmcMutation[];
} {
  const client = OmcClient.forTransport({
    send: async (cmd) => reply(cmd),
    close: () => Promise.resolve(),
  });
  const announced: OmcMutation[] = [];
  client.onMutation((mutation) => announced.push(mutation));
  return { client, announced };
}

/** OMC's empty error buffer, the reply every `getErrorString()` gets here. */
const replyTrue: Reply = (cmd) =>
  cmd.startsWith("getErrorString") ? '""' : "true";

const members = (
  parent: string,
  change: { created?: string; removed?: string } = {},
) => ({ kind: "members", parent, ...change });

describe("a typed call whose command string hides the class it touched", () => {
  it.each([
    [
      "newModel",
      () => ({ typeName: "B", withinPath: "Demo.Sub" }),
      members("Demo.Sub", { created: "Demo.Sub.B" }),
    ],
    [
      "copyClass",
      () => ({ source: "Demo.A", destination: "B", within: "Demo" }),
      members("Demo", { created: "Demo.B" }),
    ],
    [
      "moveClass",
      () => ({ typeName: "Demo.Sub.A", offset: 1 }),
      members("Demo.Sub"),
    ],
    ["moveClassToTop", () => ({ typeName: "Demo.Sub.A" }), members("Demo.Sub")],
    [
      "moveClassToBottom",
      () => ({ typeName: "Demo.Sub.A" }),
      members("Demo.Sub"),
    ],
    [
      "deleteClass",
      () => ({ typeName: "Demo.Sub.A" }),
      members("Demo.Sub", { removed: "Demo.Sub.A" }),
    ],
  ] as const)("announces %s from its input, once", async (fn, input, scope) => {
    const { client, announced } = scriptedClient(replyTrue);

    await client.invoke(fn, input());

    expect(announced).toEqual([{ fn, scope }]);
  });

  it("is coarse when the same command arrives as raw text", async () => {
    const { client, announced } = scriptedClient(replyTrue);

    await client.call("deleteClass(Demo.Sub.A)");

    expect(announced).toEqual([
      { fn: "deleteClass", scope: { kind: "coarse" } },
    ]);
  });

  it("is coarse when the parent is the top level", async () => {
    const { client, announced } = scriptedClient(replyTrue);

    await client.invoke("copyClass", { source: "Demo.A", destination: "B" });
    await client.invoke("deleteClass", { typeName: "Demo" });

    expect(announced).toEqual([
      { fn: "copyClass", scope: { kind: "coarse" } },
      { fn: "deleteClass", scope: { kind: "coarse" } },
    ]);
  });

  it("announces once the command was sent, even when its reply does not parse", async () => {
    const { client, announced } = scriptedClient((cmd) =>
      cmd.startsWith("getErrorString") ? '""' : "{unparseable",
    );

    await expect(
      client.invoke("moveClassToTop", { typeName: "Demo.A" }),
    ).rejects.toThrow();

    expect(announced).toEqual([
      { fn: "moveClassToTop", scope: members("Demo") },
    ]);
  });

  it("announces nothing when the transport throws, and leaves no claim behind", async () => {
    let fail = true;
    const { client, announced } = scriptedClient((cmd) => {
      if (fail) throw new Error("timed out");
      return replyTrue(cmd);
    });

    await expect(
      client.invoke("deleteClass", { typeName: "Demo.A" }),
    ).rejects.toThrow("timed out");
    fail = false;
    await client.call("deleteClass(Demo.A)");

    expect(announced).toEqual([
      { fn: "deleteClass", scope: { kind: "coarse" } },
    ]);
  });

  it("hands the wrapper the client itself, so a turn it takes is the one invoke holds", async () => {
    const { client } = scriptedClient(replyTrue);
    const wrapper = vi.spyOn(REGISTRY.deleteClass, "fn");

    try {
      await client.invoke("deleteClass", { typeName: "Demo.Sub.A" });

      // The turn helpers key their queues and held turns by identity.
      expect(wrapper.mock.calls[0]?.[0]).toBe(client);
    } finally {
      wrapper.mockRestore();
    }
  });

  it("leaves commands the wrapper sends before its own announcing from their text", async () => {
    const { client, announced } = scriptedClient(replyTrue);
    const wrapper = vi
      .spyOn(REGISTRY.deleteClass, "fn")
      .mockImplementation(async (ctx) => {
        await ctx.call("existClass(Demo.Sub.A)");
        await ctx.call('setClassComment(Demo.Sub.A, "x")');
        await ctx.call("deleteClass(Demo.Sub.A)");
        return { success: true };
      });

    try {
      await client.invoke("deleteClass", { typeName: "Demo.Sub.A" });
    } finally {
      wrapper.mockRestore();
    }

    expect(announced).toEqual([
      {
        fn: "setClassComment",
        scope: { kind: "class", className: "Demo.Sub.A" },
      },
      {
        fn: "deleteClass",
        scope: members("Demo.Sub", { removed: "Demo.Sub.A" }),
      },
    ]);
  });

  it("leaves a raw same-name call sent between the wrapper's probe and its own command announcing coarse", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached: () => void = () => undefined;
    const reachedGate = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const { client, announced } = scriptedClient(replyTrue);
    const wrapper = vi
      .spyOn(REGISTRY.deleteClass, "fn")
      .mockImplementation(async (ctx) => {
        await ctx.call("existClass(Demo.Sub.A)");
        reached();
        await gate;
        await ctx.call("deleteClass(Demo.Sub.A)");
        return { success: true };
      });

    try {
      const typed = client.invoke("deleteClass", { typeName: "Demo.Sub.A" });
      await reachedGate;
      await client.call("deleteClass(Other.X)");
      release();
      await typed;
    } finally {
      wrapper.mockRestore();
    }

    expect(announced).toEqual([
      { fn: "deleteClass", scope: { kind: "coarse" } },
      {
        fn: "deleteClass",
        scope: members("Demo.Sub", { removed: "Demo.Sub.A" }),
      },
    ]);
  });

  it("lets a listener that re-sends the same text announce from that text", async () => {
    const { client, announced } = scriptedClient(replyTrue);
    let resent: Promise<string> | undefined;
    client.onMutation((mutation) => {
      if (mutation.scope.kind === "members") {
        resent = client.call("deleteClass(Demo.Sub.A)");
      }
    });

    await client.invoke("deleteClass", { typeName: "Demo.Sub.A" });
    await resent;

    expect(announced).toEqual([
      {
        fn: "deleteClass",
        scope: members("Demo.Sub", { removed: "Demo.Sub.A" }),
      },
      { fn: "deleteClass", scope: { kind: "coarse" } },
    ]);
  });

  it("leaves a raw call that interleaves with it announcing for itself", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached: () => void = () => undefined;
    const reachedGate = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const { client, announced } = scriptedClient(async (cmd) => {
      if (cmd.startsWith("getErrorString")) return '""';
      if (cmd === "deleteClass(Demo.Sub.A)") {
        reached();
        await gate;
        // `false` sends the wrapper back for the error buffer, so the raw
        // call below completes while the typed one is still in flight.
        return "false";
      }
      return "true";
    });

    const typed = client.invoke("deleteClass", { typeName: "Demo.Sub.A" });
    await reachedGate;
    const raw = client.call("deleteClass(Other.B)");
    release();
    await Promise.all([typed, raw]);

    expect(announced).toEqual([
      {
        fn: "deleteClass",
        scope: members("Demo.Sub", { removed: "Demo.Sub.A" }),
      },
      { fn: "deleteClass", scope: { kind: "coarse" } },
    ]);
  });

  it("leaves a raw call queued ahead of it announcing for itself", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { client, announced } = scriptedClient(async (cmd) => {
      if (cmd.startsWith("getErrorString")) return '""';
      if (cmd === "deleteClass(Other.B)") await gate;
      return "true";
    });

    const raw = client.call("deleteClass(Other.B)");
    const typed = client.invoke("deleteClass", { typeName: "Demo.Sub.A" });
    release();
    await Promise.all([raw, typed]);

    expect(announced).toEqual([
      { fn: "deleteClass", scope: { kind: "coarse" } },
      {
        fn: "deleteClass",
        scope: members("Demo.Sub", { removed: "Demo.Sub.A" }),
      },
    ]);
  });
});
