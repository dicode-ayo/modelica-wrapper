/**
 * The one line of wiring inside `OmcClient.call()`: that a mutation reaching
 * OMC reaches the client's subscribers, and that a read does not.
 *
 * The classification itself is covered by `src/mutation.test.ts`. What only a
 * live client can show is that the announcement happens at all, and that it
 * happens outside the serial queue — a listener that calls OMC back would
 * deadlock against the slot the mutation still held.
 */

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient, type OmcMutation } from "../src/index.js";
import {
  describeIf,
  disposeFixture,
  loadFixture,
  type Fixture,
} from "./fixtures.js";

describeIf("OmcClient mutation announcements", () => {
  let client: OmcClient;
  let fixture: Fixture;
  let seen: OmcMutation[];
  let unsubscribe: () => void;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    fixture = await loadFixture(client);
    seen = [];
    unsubscribe = client.onMutation((mutation) => seen.push(mutation));
  });

  afterEach(async () => {
    unsubscribe();
    await disposeFixture(client, fixture);
    await client.close();
  });

  it("announces a mutation and stays quiet about a read", async () => {
    await client.getClassInformation({ typeName: fixture.modelClass });
    expect(seen).toEqual([]);

    await client.setClassComment({
      typeName: fixture.modelClass,
      filename: "announced",
    });

    expect(seen).toEqual([
      {
        fn: "setClassComment",
        scope: { kind: "class", className: fixture.modelClass },
      },
    ]);
  });

  it("keeps a throwing listener from failing the call it rides on", async () => {
    unsubscribe();
    unsubscribe = client.onMutation(() => {
      throw new Error("listener exploded");
    });

    await expect(
      client.setClassComment({
        typeName: fixture.modelClass,
        filename: "survived",
      }),
    ).resolves.toBeDefined();
  });

  it("lets a listener call OMC back without deadlocking the queue", async () => {
    const answers: string[] = [];
    unsubscribe();
    unsubscribe = client.onMutation(() => {
      void client
        .getClassRestriction({ typeName: fixture.modelClass })
        .then(({ restriction }) => answers.push(restriction));
    });

    await client.setClassComment({
      typeName: fixture.modelClass,
      filename: "reentrant",
    });
    // The listener's call was issued from outside the slot, so it queues
    // normally behind this one rather than waiting on it.
    await client.getVersion();

    expect(answers).toEqual(["model"]);
  });
});
