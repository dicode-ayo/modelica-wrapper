/**
 * What `OmcClient` announces for a command, driven through its real `call()`
 * against a scripted transport.
 */

import { describe, expect, it } from "vitest";

import { OmcClient } from "./client.js";
import type { OmcMutation } from "./mutation.js";

type Reply = (cmd: string) => string | Promise<string>;

/** A client whose transport answers each command with `reply`. */
function scriptedClient(reply: Reply): {
  client: OmcClient;
  announced: OmcMutation[];
} {
  const transport = {
    send: async (cmd: string) => reply(cmd),
  };
  // The constructor is private; `create()` spawns a real OMC.
  const client: OmcClient = Reflect.construct(OmcClient, [{}, transport, 0]);
  const announced: OmcMutation[] = [];
  client.onMutation((mutation) => announced.push(mutation));
  return { client, announced };
}

/** OMC's empty error buffer, the reply every `getErrorString()` gets here. */
const replyTrue: Reply = (cmd) =>
  cmd.startsWith("getErrorString") ? '""' : "true";

describe("a typed call whose command string hides the class it touched", () => {
  it.each([
    [
      "newModel",
      () => ({ typeName: "B", withinPath: "Demo.Sub" }),
      ["Demo.Sub"],
    ],
    [
      "copyClass",
      () => ({ source: "Demo.A", destination: "B", within: "Demo" }),
      ["Demo"],
    ],
    ["moveClassToTop", () => ({ typeName: "Demo.Sub.A" }), ["Demo.Sub"]],
    [
      "deleteClass",
      () => ({ typeName: "Demo.Sub.A" }),
      ["Demo.Sub", "Demo.Sub.A"],
    ],
  ] as const)(
    "announces %s from its input, once",
    async (fn, input, classNames) => {
      const { client, announced } = scriptedClient(replyTrue);

      await client.invoke(fn, input());

      expect(announced).toEqual(
        classNames.map((className) => ({
          fn,
          scope: { kind: "class", className },
        })),
      );
    },
  );

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
      { fn: "moveClassToTop", scope: { kind: "class", className: "Demo" } },
    ]);
  });

  it("announces nothing when the transport throws", async () => {
    const { client, announced } = scriptedClient(() => {
      throw new Error("timed out");
    });

    await expect(
      client.invoke("deleteClass", { typeName: "Demo.A" }),
    ).rejects.toThrow("timed out");

    expect(announced).toEqual([]);
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

    expect(announced).toHaveLength(3);
    expect(announced).toEqual(
      expect.arrayContaining([
        { fn: "deleteClass", scope: { kind: "class", className: "Demo.Sub" } },
        {
          fn: "deleteClass",
          scope: { kind: "class", className: "Demo.Sub.A" },
        },
        { fn: "deleteClass", scope: { kind: "coarse" } },
      ]),
    );
  });
});
