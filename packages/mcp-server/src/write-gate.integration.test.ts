/**
 * The write gate against a real OMC, driven through the published tool surface.
 *
 * Every mocked test in `write-gate.test.ts` assumes what OMC reports for a path
 * and a class. This file assumes nothing: it installs no library, it reads the
 * `MODELICAPATH` the compiler actually has, and it asks the real
 * `setSourceFile` to repoint a real class at a real library file.
 *
 * Gating mirrors the omc-client integration tests: `OMC_INTEGRATION=0` forces
 * skip, `OMC_INTEGRATION=1` forces run, otherwise `omc` on `PATH` decides.
 */

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { OmcClient, isLikelyDiskPath } from "@dicode/omc-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { McpToolClient } from "./dispatch.js";
import { buildMcpServer } from "./mcp-server.js";
import type {
  WriteVerdict,
  WriteVerdictClient,
  WriteVerdictSource,
} from "./write-verdict.js";

function shouldRun(): boolean {
  const flag = process.env.OMC_INTEGRATION;
  if (flag === "0") return false;
  if (flag === "1") return true;
  try {
    execSync(process.platform === "win32" ? "where omc" : "command -v omc", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The extension's verdict rule, restated over the structural client this
 * package declares: a class whose source sits under `MODELICAPATH` belongs to a
 * system library however its files are chmod'ed.
 */
const verdicts: WriteVerdictSource = {
  forClass: async (
    client: WriteVerdictClient,
    className: string,
  ): Promise<WriteVerdict> => {
    const { fileName } = await client.getSourceFile({ typeName: className });
    if (!isLikelyDiskPath(fileName)) return { ok: true };
    const { modelicaPath } = await client.getModelicaPath();
    const file = path.resolve(fileName);
    const inLibrary = modelicaPath
      .split(path.delimiter)
      .map((root) => root.trim())
      .filter((root) => root.length > 0)
      .some((root) => {
        const rel = path.relative(path.resolve(root), file);
        return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
      });
    return inLibrary
      ? {
          ok: false,
          reason: `Cannot edit ${className} — it belongs to a read-only system library.`,
        }
      : { ok: true };
  },
};

const describeIf = shouldRun() ? describe : describe.skip;

describeIf("the write gate against live OMC", () => {
  const suffix = randomBytes(4).toString("hex");
  const ownClass = `MwGate_${suffix}`;
  let client: OmcClient;
  let mcp: Client;
  let tmpDir: string;
  let libraryFile: string;

  /** The file an installed library stores one of its classes in. */
  async function libraryMemberFile(): Promise<string> {
    const { success } = await client.loadModel({ typeName: "Modelica" });
    if (!success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`loadModel(Modelica) failed: ${errorString}`);
    }
    const { fileName } = await client.getSourceFile({
      typeName: "Modelica.Blocks.Math",
    });
    if (!isLikelyDiskPath(fileName)) {
      throw new Error(
        `Modelica.Blocks.Math has no on-disk source: ${fileName}`,
      );
    }
    return fileName;
  }

  beforeAll(async () => {
    client = await OmcClient.create();
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "mw-gate-"));
    libraryFile = await libraryMemberFile();

    const ownFile = path.join(tmpDir, `${ownClass}.mo`);
    await fsp.writeFile(
      ownFile,
      `model ${ownClass}\n  Real x;\nend ${ownClass};\n`,
      "utf8",
    );
    const { success } = await client.loadFile({ fileName: ownFile });
    if (!success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`loadFile(${ownFile}) failed: ${errorString}`);
    }

    const server = buildMcpServer(
      {
        ensureClient: async () => client as unknown as McpToolClient,
        verdicts,
      },
      "integration",
    );
    mcp = new Client({ name: "integration", version: "0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), mcp.connect(clientSide)]);
  }, 120_000);

  afterAll(async () => {
    await client.close();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  /** `setSourceFile` as an assistant reaches it: through `omc_invoke`. */
  async function repoint(fileName: string): Promise<CallToolResult> {
    return (await mcp.callTool({
      name: "omc_invoke",
      arguments: {
        fn: "setSourceFile",
        input: { typeName: ownClass, fileName },
      },
    })) as CallToolResult;
  }

  function text(result: CallToolResult): string {
    const [first] = result.content;
    if (first?.type !== "text") throw new Error("no text content");
    return first.text;
  }

  it("refuses to repoint the caller's own class at an installed library's file (#700)", async () => {
    const result = await repoint(libraryFile);

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("read-only system library");
    // The refusal is the whole of it: OMC still stores the library class where
    // it did, so a `save` on either class writes what it always wrote.
    const { fileName } = await client.getSourceFile({
      typeName: "Modelica.Blocks.Math",
    });
    expect(fileName).toBe(libraryFile);
    const own = await client.getSourceFile({ typeName: ownClass });
    expect(own.fileName).not.toBe(libraryFile);
  });

  it("lets the same class move to a file the caller owns", async () => {
    const destination = path.join(tmpDir, `${ownClass}.renamed.mo`);

    const result = await repoint(destination);

    expect(result.isError).toBeFalsy();
    const { fileName } = await client.getSourceFile({ typeName: ownClass });
    expect(fileName).toBe(destination);
  });
});
