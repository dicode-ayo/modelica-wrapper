/**
 * Pins the end-column convention of `getModelInstance` source locations
 * against a real OMC: `onGoToSource` (diagram-editor-provider) converts them
 * with `omcRangeToVscodeRange`, whose inclusive-end-column rule was confirmed
 * for `getClassInformation` — so the two APIs must report the same extent
 * with the same end column for the same class, or the go-to-source selection
 * is off by one. (`getMessagesStringInternal` reports exclusive end columns;
 * conventions diverge per API, hence this pin.)
 *
 * Gating mirrors the omc-client suites: auto-runs when `omc` is on PATH (or
 * `OMC_PATH` / `OMC_INTEGRATION=1` is set); auto-skips otherwise.
 */

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient } from "@dicode/omc-client";

import { describeIf } from "../../test-support/integration-gate.js";
import { fetchDiagramLayout } from "./open-diagram.js";

describeIf("getModelInstance source locations against real OMC", () => {
  let client: OmcClient;
  let pkg: string;
  let cls: string;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    const { randomBytes } = await import("node:crypto");
    pkg = `MwGoTo_${randomBytes(4).toString("hex")}`;
    cls = `${pkg}.Gauge`;
    await client.loadString({
      data: `package ${pkg}
  model Gauge
    Real x = 1;
  end Gauge;
end ${pkg};
`,
      filename: `<fixture:${pkg}>`,
    });
  }, 60_000);

  afterEach(async () => {
    await client.close();
  });

  it("reports the class extent with getClassInformation's end-column convention", async () => {
    const layout = await fetchDiagramLayout(client, cls);
    const info = await client.getClassInformation({ typeName: cls });

    expect(layout.source.lineStart).toBe(info.lineNumberStart);
    expect(layout.source.columnStart).toBe(info.columnNumberStart);
    expect(layout.source.lineEnd).toBe(info.lineNumberEnd);
    // The load-bearing assertion: an exclusive-end `getModelInstance` would
    // differ by one here, and `onGoToSource`'s `omcRangeToVscodeRange` (the
    // inclusive-end rule) would select one column too many.
    expect(layout.source.columnEnd).toBe(info.columnNumberEnd);
  });
});
