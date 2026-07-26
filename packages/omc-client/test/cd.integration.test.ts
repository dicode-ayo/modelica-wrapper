/**
 * Integration tests for the `cd` wrapper.
 *
 * Three behaviours we care about:
 *
 *   1. `cd({})` (empty path, the default) acts as a getter — returns a
 *      non-empty current working directory without changing it.
 *   2. `cd({ newWorkingDirectory: "/tmp" })` changes OMC's cwd and returns
 *      the new path. OMC may normalize the result (resolved/absolutised),
 *      so we accept anything ending with `/tmp` rather than insisting on
 *      a byte-for-byte match.
 *   3. `cd({ newWorkingDirectory: "<bogus path>" })` does not throw from
 *      the wrapper — OMC's scripting `cd` is non-throwing on invalid paths.
 *      The observed behaviour on OMC 1.26.x is to return the prior cwd
 *      (effectively a no-op); other OMC builds may return an empty string.
 *      Either response is acceptable here; we just assert the call resolves.
 */

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";
import { describeIf } from "./fixtures.js";

describeIf("cd against real OMC", () => {
  let client: OmcClient;

  beforeEach(async () => {
    client = await OmcClient.create({
      omcPath: process.env.OMC_PATH ?? "",
    });
    // Drain startup chatter so each test's getErrorString reading is
    // attributable to this test only.
    await client.getErrorString();
  });

  afterEach(async () => {
    await client.close();
  });

  it("empty input returns the current working directory without changing it", async () => {
    const before = await client.cd({});
    expect(typeof before.workingDirectory).toBe("string");
    expect(before.workingDirectory.length).toBeGreaterThan(0);

    // Calling cd({}) a second time should yield the same path — it's
    // a pure getter when the input is empty.
    const again = await client.cd({});
    expect(again.workingDirectory).toBe(before.workingDirectory);
  });

  it("changes cwd to /tmp and returns the new path", async () => {
    const { workingDirectory } = await client.cd({
      newWorkingDirectory: "/tmp",
    });
    expect(workingDirectory.length).toBeGreaterThan(0);
    // OMC may resolve symlinks (e.g. /tmp -> /private/tmp on macOS) so we
    // tolerate any path ending with "/tmp" rather than requiring an exact
    // string match.
    expect(workingDirectory.endsWith("/tmp")).toBe(true);

    // Sanity-check: the getter now reports the same path.
    const after = await client.cd({});
    expect(after.workingDirectory).toBe(workingDirectory);
  });

  it("invalid path does not throw; OMC returns an in-band error string", async () => {
    // Snapshot the current cwd so we can verify nothing changed.
    const { workingDirectory: priorCwd } = await client.cd({});

    // The wrapper must not throw — OMC's scripting `cd` is non-throwing
    // on bad input. Observed behaviour on OMC 1.26.7: the `workingDirectory`
    // output field is populated with an in-band error message of the form
    //   "Error, directory <path> does not exist,"
    // instead of an empty string or the prior cwd, and OMC's cwd is left
    // unchanged. Earlier OMC builds may instead return an empty string.
    // The wrapper itself imposes no shape — it just surfaces what OMC says.
    const result = await client.cd({
      newWorkingDirectory: "/nonexistent-mw-probe-path-XXXXX",
    });
    expect(typeof result.workingDirectory).toBe("string");

    // The "did the cd succeed?" signal is whether OMC's cwd actually
    // moved. It must NOT have — verify via a follow-up getter call.
    const { workingDirectory: nowCwd } = await client.cd({});
    expect(nowCwd).toBe(priorCwd);
  });
});
