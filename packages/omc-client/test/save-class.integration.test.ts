/**
 * Integration test: a class edited after creation, end to end against live OMC.
 *
 * A model built through the mutating calls — components, connections,
 * parameters — simulates correctly while the file on disk is still the stub it
 * was created as, because none of those calls writes anything.
 *
 * What matters here is not that `saveClass` returns a path: it is that a
 * *fresh* OMC, which has never seen the edits, loads the tree and finds them.
 *
 * Auto-skips when OMC isn't on PATH; honors `OMC_INTEGRATION=0/1` overrides
 * the same way the rest of this suite does.
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { OmcClient, saveClass, type SourceTree } from "../src/index.js";

import { describeIf } from "./fixtures.js";

async function declare(
  client: OmcClient,
  typeName: string,
  data: string,
): Promise<void> {
  const { success } = await client.loadString({
    data,
    filename: `<runtime:${typeName}>`,
    merge: true,
  });
  if (!success) {
    const { errorString } = await client.getErrorString();
    throw new Error(`loadString failed for ${typeName}: ${errorString}`);
  }
}

describeIf("saveClass + OMC roundtrip", () => {
  let client: OmcClient;
  let ws: string;
  let tree: SourceTree;

  beforeEach(async () => {
    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    ws = await fsp.mkdtemp(path.join(os.tmpdir(), "save-class-int-"));
    tree = {
      root: ws,
      writer: { write: (fsPath, text) => fsp.writeFile(fsPath, text, "utf8") },
    };
  });

  afterEach(async () => {
    await client.close();
    await fsp.rm(ws, { recursive: true, force: true });
  });

  it("carries an edit made after createClass into a fresh OMC", async () => {
    await declare(client, "SaveDemo", "package SaveDemo\nend SaveDemo;\n");
    await declare(
      client,
      "SaveDemo.Circuit",
      "within SaveDemo;\nmodel Circuit\nend Circuit;\n",
    );

    // The edits the issue is about: nothing here writes a file.
    const added = await client.addComponent({
      componentName: "r",
      componentClass: "Real",
      intoTypeName: "SaveDemo.Circuit",
    });
    expect(added.success).toBe(true);
    const modified = await client.setElementModifierValue({
      typeName: "SaveDemo.Circuit",
      elementName: "r",
      expr: "220.0",
    });
    expect(modified.success).toBe(true);

    const { saved } = await saveClass(client, tree, "SaveDemo");

    expect(saved.map((s) => s.className)).toEqual([
      "SaveDemo",
      "SaveDemo.Circuit",
    ]);
    await client.close();

    // Fresh process — it has only what reached disk.
    const fresh = await OmcClient.create({
      omcPath: process.env.OMC_PATH ?? "",
    });
    try {
      const { success } = await fresh.loadFile({
        fileName: path.join(ws, "SaveDemo", "package.mo"),
      });
      expect(success).toBe(true);
      const { contents } = await fresh.listFile({
        typeName: "SaveDemo.Circuit",
      });
      expect(contents).toContain("Real r");
      expect(contents).toContain("220.0");
    } finally {
      await fresh.close();
    }
  });
});
