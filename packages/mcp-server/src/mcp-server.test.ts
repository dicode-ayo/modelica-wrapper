/**
 * The published tool surface, driven through a real MCP client over the SDK's
 * in-memory transport. No HTTP and no OMC: the client is a stub recording what
 * `invoke` was called with.
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { SourceTree } from "@dicode/omc-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { WriteVerdictClient } from "./write-verdict.js";
import type { McpToolClient } from "./dispatch.js";
import { buildMcpServer } from "./mcp-server.js";
import { PARITY_TOOLS } from "./parity-tools.js";
import type { WriteVerdictSource } from "./write-verdict.js";

interface Call {
  fn: string;
  input: unknown;
}

const SYSTEM_LIBRARY = "Modelica.Blocks.Math.Sin";
const REFUSAL = `Cannot edit ${SYSTEM_LIBRARY} — it belongs to a read-only system library.`;

const calls: Call[] = [];
let failWith: string | undefined;

let sourceFile = "/w/Demo.mo";
let loaded: Set<string>;
let loadFails: string | undefined;
let unloadFails: string | undefined;
let rootPackageClasses: string[];
/** What `getClassInformation` reports as a class's file, as OMC would. */
let classFiles: Map<string, string>;
let workspace: SourceTree | undefined;

/**
 * The wrappers `createClass` composes are recorded alongside `invoke` so every
 * assertion reads the same way, whichever path reached OMC.
 */
const client: McpToolClient = {
  invoke: async (fn, input) => {
    calls.push({ fn, input });
    if (failWith !== undefined) throw new Error(failWith);
    return { ok: true };
  },
  deleteClass: async (input) => {
    calls.push({ fn: "deleteClass", input });
    if (unloadFails !== undefined) throw new Error(unloadFails);
    return { success: true };
  },
  existClass: async ({ typeName }) => ({ exists: loaded.has(typeName) }),
  getClassInformation: async ({ typeName }) => ({
    fileReadOnly: false,
    fileName: classFiles.get(typeName) ?? "",
    restriction: loaded.has(typeName) ? "package" : "",
  }),
  parseFile: async () => ({ classNames: rootPackageClasses }),
  getClassNames: async () => ({ classNames: [] }),
  getErrorString: async () => ({ errorString: loadFails ?? "" }),
  loadString: async (input) => {
    calls.push({ fn: "loadString", input });
    return { success: loadFails === undefined };
  },
  setSourceFile: async (input) => {
    calls.push({ fn: "setSourceFile", input });
    return { success: true };
  },
  getSourceFile: async () => ({ fileName: sourceFile }),
  getModelicaPath: async () => ({ modelicaPath: "/usr/lib/omlibrary" }),
};

const verdicts: WriteVerdictSource = {
  forClass: async (_c: WriteVerdictClient, className: string) =>
    className === SYSTEM_LIBRARY
      ? { ok: false, reason: REFUSAL }
      : { ok: true },
};

async function connect(): Promise<Client> {
  const server = buildMcpServer(
    { ensureClient: async () => client, verdicts, workspace },
    "1.2.3",
  );
  const mcp = new Client({ name: "test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), mcp.connect(clientSide)]);
  return mcp;
}

/** A writer that fails after `persistClass` has made the directories. */
const rejectingWriter = {
  write: () => Promise.reject(new Error("EACCES: permission denied")),
};

/** The one text block a tool result carries. */
function text(result: CallToolResult): string {
  const [first] = result.content;
  if (first?.type !== "text") throw new Error("no text content");
  return first.text;
}

beforeEach(() => {
  calls.length = 0;
  failWith = undefined;
  sourceFile = "/w/Demo.mo";
  loaded = new Set();
  loadFails = undefined;
  unloadFails = undefined;
  rootPackageClasses = [];
  classFiles = new Map();
  workspace = undefined;
});

describe("the published tool set", () => {
  it("is the curated parity set plus the shape and escape-hatch tools", async () => {
    const mcp = await connect();

    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toHaveLength(PARITY_TOOLS.length + 2 + 7 + 3);
    expect(names).toContain("readSimulationResult");
    expect(names).toEqual(expect.arrayContaining([...PARITY_TOOLS]));
    expect(names).toEqual(
      expect.arrayContaining([
        "addRectangle",
        "addEllipse",
        "addLine",
        "addPolygon",
        "addText",
        "removeShape",
        "setCoordinateSystem",
        "omc_list_functions",
        "omc_describe_function",
        "omc_invoke",
        "setSourceCode",
        "createClass",
      ]),
    );
    // `writeClassGraphics` is what the seven shape tools replace, and
    // `loadString` what `setSourceCode` replaces; either published raw would
    // undo the reason its replacement exists.
    expect(names).not.toContain("writeClassGraphics");
    expect(names).not.toContain("loadString");
    // `newModel` is what `createClass` replaces: it registers a class and
    // writes nothing, so a caller who stops there loses it at the next restart.
    expect(names).not.toContain("newModel");
  });

  it("hints read-only exactly where the mutation table says nothing changes", async () => {
    const mcp = await connect();

    const { tools } = await mcp.listTools();
    const hint = (name: string): boolean | undefined =>
      tools.find((t) => t.name === name)?.annotations?.readOnlyHint;

    expect(hint("getClassNames")).toBe(true);
    expect(hint("getModelInstance")).toBe(true);
    expect(hint("addComponent")).toBe(false);
    expect(hint("addRectangle")).toBe(false);
    // Read-only or mutating depending on `fn`, and annotations are per-tool.
    expect(hint("omc_invoke")).toBe(false);
  });

  it("leaves room for the prefix VSCode puts in front of every name", async () => {
    // `McpToolName` in VSCode's `contrib/mcp/common/mcpTypes.ts`: a tool is
    // presented as `mcp_<server>_<tool>`, the prefix is capped at
    // MaxPrefixLen and the whole name at MaxLength. A name over the budget is
    // truncated, and two that collide after truncation are indistinguishable.
    const maxPrefixLength = 18;
    const maxLength = 64;
    const mcp = await connect();

    const { tools } = await mcp.listTools();
    const tooLong = tools
      .map((t) => t.name)
      .filter((n) => n.length > maxLength - maxPrefixLength);

    expect(tooLong).toEqual([]);
  });

  it("publishes no outputSchema, which the SDK could not project", async () => {
    const mcp = await connect();

    const { tools } = await mcp.listTools();

    expect(tools.filter((t) => t.outputSchema !== undefined)).toEqual([]);
  });
});

describe("the server's instructions", () => {
  it("reach the client alongside the tool list", async () => {
    const mcp = await connect();

    const instructions = mcp.getInstructions();

    // A tool description reaches a model once it is already reading that tool;
    // this reaches it while it is still deciding what to do.
    expect(instructions).toContain("createClass declares it");
    expect(instructions).toContain("readSimulationResult returns whole series");
    expect(instructions).toContain("typeName rather than cl");
  });
});

describe("calling a tool", () => {
  it("dispatches through invoke with the validated input", async () => {
    const mcp = await connect();

    await mcp.callTool({
      name: "getClassNames",
      arguments: { typeName: "Demo", recursive: true },
    });

    expect(calls).toEqual([
      {
        fn: "getClassNames",
        input: expect.objectContaining({ typeName: "Demo", recursive: true }),
      },
    ]);
  });

  it("refuses the whole call when the class is not the user's to write", async () => {
    const mcp = await connect();

    const result = (await mcp.callTool({
      name: "addComponent",
      arguments: {
        componentName: "r1",
        componentClass: "Modelica.Electrical.Analog.Basic.Resistor",
        intoTypeName: SYSTEM_LIBRARY,
      },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toBe(REFUSAL);
    expect(calls).toEqual([]);
  });

  it("reports an OMC failure as a tool error, not a transport one", async () => {
    const mcp = await connect();
    failWith = "Class Demo not found";

    const result = (await mcp.callTool({
      name: "getClassNames",
      arguments: { typeName: "Demo" },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Class Demo not found");
  });

  it("rejects an argument the schema does not accept before OMC sees it", async () => {
    const mcp = await connect();

    const result = (await mcp.callTool({
      name: "getClassNames",
      arguments: { typeName: 42 },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("the shape tools", () => {
  it("compose one writeClassGraphics add from a flat extent", async () => {
    const mcp = await connect();

    await mcp.callTool({
      name: "addRectangle",
      arguments: {
        typeName: "Demo.Circuit",
        layer: "icon",
        extent: [-10, -10, 10, 10],
        fillColor: [255, 0, 0],
      },
    });

    expect(calls).toEqual([
      {
        fn: "writeClassGraphics",
        input: {
          typeName: "Demo.Circuit",
          layer: "icon",
          op: {
            kind: "add",
            shape: expect.objectContaining({
              kind: "rectangle",
              extent: [
                [-10, -10],
                [10, 10],
              ],
              fillColor: [255, 0, 0],
            }),
          },
        },
      },
    ]);
  });

  it("address a shape by its position in the layer's graphics list", async () => {
    const mcp = await connect();

    await mcp.callTool({
      name: "removeShape",
      arguments: { typeName: "Demo.Circuit", layer: "icon", index: 2 },
    });

    expect(calls).toEqual([
      {
        fn: "writeClassGraphics",
        input: {
          typeName: "Demo.Circuit",
          layer: "icon",
          op: { kind: "delete", index: 2 },
        },
      },
    ]);
  });

  it("forward only the coordinate-system fields the caller named", async () => {
    const mcp = await connect();

    await mcp.callTool({
      name: "setCoordinateSystem",
      arguments: {
        typeName: "Demo.Circuit",
        layer: "diagram",
        extent: [-50, -50, 50, 50],
      },
    });

    expect(calls).toEqual([
      {
        fn: "writeClassGraphics",
        input: {
          typeName: "Demo.Circuit",
          layer: "diagram",
          op: {
            kind: "setCoordinateSystem",
            coordinateSystem: { extent: [-50, -50, 50, 50] },
          },
        },
      },
    ]);
  });

  it("each advertise only the fields their own shape has", async () => {
    const mcp = await connect();

    const { tools } = await mcp.listTools();
    const fields = (name: string): string[] =>
      Object.keys(
        tools.find((t) => t.name === name)?.inputSchema.properties ?? {},
      );

    expect(fields("addLine")).not.toContain("fillPattern");
    expect(fields("addLine")).not.toContain("extent");
    expect(fields("addRectangle")).not.toContain("points");
    expect(fields("addText")).not.toContain("fillColor");
  });
});

describe("the escape hatch", () => {
  it("lists by category rather than flat", async () => {
    const mcp = await connect();

    const overview = (await mcp.callTool({
      name: "omc_list_functions",
      arguments: {},
    })) as CallToolResult;
    const solver = (await mcp.callTool({
      name: "omc_list_functions",
      arguments: { category: "solver" },
    })) as CallToolResult;

    expect(text(overview)).toContain("solver");
    expect(text(solver)).toContain("functions:");
    expect(text(solver).length).toBeLessThan(4000);
  });

  it("projects the input schema only, which the two model-instance calls need", async () => {
    const mcp = await connect();

    const result = (await mcp.callTool({
      name: "omc_describe_function",
      arguments: { name: "getModelInstance" },
    })) as CallToolResult;

    const described: unknown = JSON.parse(text(result));
    expect(described).toMatchObject({ name: "getModelInstance" });
    expect(described).not.toHaveProperty("output");
  });

  it("names its neighbors when the function does not exist", async () => {
    const mcp = await connect();

    const result = (await mcp.callTool({
      name: "omc_invoke",
      arguments: { fn: "getClassName", input: {} },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("getClassNames");
    expect(calls).toEqual([]);
  });

  it("refuses an argument the function does not have, rather than dropping it", async () => {
    const mcp = await connect();

    // `getVersion` takes an optional class and has an argument-less OMC
    // overload, so a dropped argument answers a different question: the
    // compiler's version instead of the library's.
    const result = (await mcp.callTool({
      name: "omc_invoke",
      arguments: { fn: "getVersion", input: { cl: "Modelica" } },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("no argument named cl");
    expect(text(result)).toContain("typeName");
    expect(calls).toEqual([]);
  });

  it("reaches a function the curated set leaves out, through the same gate", async () => {
    const mcp = await connect();

    const refused = (await mcp.callTool({
      name: "omc_invoke",
      arguments: {
        fn: "deleteClass",
        input: { typeName: SYSTEM_LIBRARY },
      },
    })) as CallToolResult;
    await mcp.callTool({
      name: "omc_invoke",
      arguments: { fn: "deleteClass", input: { typeName: "Demo.Circuit" } },
    });

    expect(text(refused)).toBe(REFUSAL);
    expect(calls).toEqual([
      { fn: "deleteClass", input: { typeName: "Demo.Circuit" } },
    ]);
  });
});

describe("createClass", () => {
  it("refuses a package that is not the user's to write into", async () => {
    const mcp = await connect();

    const result = (await mcp.callTool({
      name: "createClass",
      arguments: { name: "Mine", kind: "model", withinPath: SYSTEM_LIBRARY },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toBe(REFUSAL);
    expect(calls).toEqual([]);
  });

  it("refuses to load over a class that already exists", async () => {
    const mcp = await connect();
    loaded.add("Demo.Circuit");

    const result = (await mcp.callTool({
      name: "createClass",
      arguments: { name: "Circuit", kind: "model", withinPath: "Demo" },
    })) as CallToolResult;

    // `loadString` with merge would replace the class, discarding its body.
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("already exists");
    expect(calls).toEqual([]);
  });

  it("declares the class under a within clause, and says so when there is nowhere to write it", async () => {
    loaded.add("Modelica.Icons.Example");
    const mcp = await connect();

    const result = (await mcp.callTool({
      name: "createClass",
      arguments: {
        name: "Circuit",
        kind: "block",
        withinPath: "Demo",
        extendsFrom: "Modelica.Icons.Example",
      },
    })) as CallToolResult;

    expect(calls).toEqual([
      {
        fn: "loadString",
        input: {
          data:
            "within Demo;\nblock Circuit\n" +
            "  extends Modelica.Icons.Example;\nend Circuit;\n",
          filename: "<runtime:Demo.Circuit>",
          merge: true,
        },
      },
    ]);
    expect(JSON.parse(text(result))).toMatchObject({
      className: "Demo.Circuit",
      fileName: null,
    });
  });

  it("refuses an empty withinPath rather than reading it as top-level", async () => {
    const mcp = await connect();

    const result = (await mcp.callTool({
      name: "createClass",
      arguments: { name: "Loose", kind: "model", withinPath: "" },
    })) as CallToolResult;

    // Empty is not nullish, so it would skip the root-package resolver and
    // land a class with no `within` clause beside the root package.mo.
    expect(result.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it("refuses to extend a class that is not loaded", async () => {
    const mcp = await connect();

    const result = (await mcp.callTool({
      name: "createClass",
      arguments: {
        name: "Circuit",
        kind: "model",
        extendsFrom: "Modelica.Icons.Exmaple",
      },
    })) as CallToolResult;

    // OMC accepts a base class that does not exist, so the broken class would
    // reach disk reported as a success.
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Modelica.Icons.Exmaple");
    expect(calls).toEqual([]);
  });

  it("reports OMC's own reason when the class will not parse", async () => {
    const mcp = await connect();
    loadFails = "Parse error near 'end'";

    const result = (await mcp.callTool({
      name: "createClass",
      arguments: { name: "Broken", kind: "model" },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Parse error near 'end'");
  });

  it("nests a class under the package the tree's own root declares", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mcp-rootpkg-"));
    await fsp.writeFile(
      path.join(root, "package.mo"),
      "package Demo\nend Demo;\n",
      "utf8",
    );
    await fsp.writeFile(path.join(root, "package.order"), "", "utf8");
    rootPackageClasses = ["Demo"];
    loaded.add("Demo");
    classFiles.set("Demo", path.join(root, "package.mo"));
    workspace = {
      root,
      writer: {
        write: (fsPath, textContent) =>
          fsp.writeFile(fsPath, textContent, "utf8"),
      },
    };
    const mcp = await connect();

    try {
      const result = (await mcp.callTool({
        name: "createClass",
        arguments: { name: "Circuit", kind: "model" },
      })) as CallToolResult;

      // Written beside the root package.mo with no `within`, OMC refuses the
      // whole package rather than just this file.
      expect(JSON.parse(text(result))).toEqual({
        className: "Demo.Circuit",
        fileName: path.join(root, "Circuit.mo"),
      });
      expect(await fsp.readFile(path.join(root, "Circuit.mo"), "utf8")).toBe(
        "within Demo;\nmodel Circuit\nend Circuit;\n",
      );
      expect(await fsp.readFile(path.join(root, "package.order"), "utf8")).toBe(
        "Circuit\n",
      );
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses when the tree's root package cannot be named", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mcp-rootpkg-"));
    await fsp.writeFile(path.join(root, "package.mo"), "", "utf8");
    rootPackageClasses = ["A", "B"];
    workspace = {
      root,
      writer: { write: () => Promise.resolve() },
    };
    const mcp = await connect();

    try {
      const result = (await mcp.callTool({
        name: "createClass",
        arguments: { name: "Circuit", kind: "model" },
      })) as CallToolResult;

      expect(result.isError).toBe(true);
      expect(text(result)).toContain("more than one top-level class");
      expect(text(result)).toContain("withinPath");
      expect(calls).toEqual([]);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("warns that a single-file parent will not bring the new class in", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mcp-inline-"));
    await fsp.writeFile(
      path.join(root, "Demo.mo"),
      "package Demo\nend Demo;\n",
      "utf8",
    );
    classFiles.set("Demo", path.join(root, "Demo.mo"));
    workspace = {
      root,
      writer: {
        write: (fsPath, textContent) =>
          fsp.writeFile(fsPath, textContent, "utf8"),
      },
    };
    const mcp = await connect();

    try {
      const result = (await mcp.callTool({
        name: "createClass",
        arguments: { name: "Circuit", kind: "model", withinPath: "Demo" },
      })) as CallToolResult;

      // The file is written and loaded, but no package.order names it, so a
      // loader that opens Demo.mo on its own never reads it.
      const written = JSON.parse(text(result)) as {
        fileName: string;
        warning?: string;
      };
      expect(written.fileName).toBe(path.join(root, "Circuit.mo"));
      expect(written.warning).toContain("single file");
      expect(written.warning).toContain("setSourceCode");
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("unloads the class again when its files cannot be written", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mcp-unwritable-"));
    workspace = { root, writer: rejectingWriter };
    const mcp = await connect();

    try {
      const result = (await mcp.callTool({
        name: "createClass",
        arguments: { name: "Loose", kind: "model" },
      })) as CallToolResult;

      // Left loaded it would be the very thing this tool exists to prevent,
      // and the retry would be refused for already existing.
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("EACCES");
      expect(text(result)).toContain("unloaded");
      expect(calls).toContainEqual({
        fn: "deleteClass",
        input: { typeName: "Loose" },
      });
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("says the class is still loaded when unloading it also fails", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mcp-unwritable-"));
    workspace = { root, writer: rejectingWriter };
    unloadFails = "deleteClass returned false";
    const mcp = await connect();

    try {
      const result = (await mcp.callTool({
        name: "createClass",
        arguments: { name: "Loose", kind: "model" },
      })) as CallToolResult;

      // The caller has to know a retry will be refused, and why.
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("still loaded in OMC");
      expect(text(result)).toContain("deleteClass returned false");
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("writes the file and points OMC at it", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mcp-create-"));
    const written: string[] = [];
    workspace = {
      root,
      writer: {
        write: async (fsPath, textContent) => {
          written.push(fsPath);
          await fsp.writeFile(fsPath, textContent, "utf8");
        },
      },
    };
    const mcp = await connect();

    try {
      const result = (await mcp.callTool({
        name: "createClass",
        arguments: { name: "Loose", kind: "model" },
      })) as CallToolResult;

      const leaf = path.join(root, "Loose.mo");
      expect(JSON.parse(text(result))).toEqual({
        className: "Loose",
        fileName: leaf,
      });
      expect(written).toEqual([leaf]);
      expect(await fsp.readFile(leaf, "utf8")).toBe(
        "model Loose\nend Loose;\n",
      );
      // Without this OMC keeps the `<runtime:…>` placeholder, and the next
      // save writes to a path that is not a path.
      expect(calls).toContainEqual({
        fn: "setSourceFile",
        input: { typeName: "Loose", fileName: leaf },
      });
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});

describe("setSourceCode", () => {
  it("refuses a class that is not the user's to write", async () => {
    const mcp = await connect();

    const result = (await mcp.callTool({
      name: "setSourceCode",
      arguments: { className: SYSTEM_LIBRARY, code: "model Sin end Sin;" },
    })) as CallToolResult;

    // The gate is the whole reason this tool exists rather than `loadString`,
    // whose arguments name no class for a verdict to be derived from.
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(REFUSAL);
    expect(calls).toEqual([]);
  });

  it("reloads the class under the file it already came from", async () => {
    const mcp = await connect();

    await mcp.callTool({
      name: "setSourceCode",
      arguments: {
        className: "Demo.Circuit",
        code: "model Circuit end Circuit;",
      },
    });

    // `loadString` binds the class to whatever filename it is given, and the
    // default would evict it from the file it was stored in.
    expect(calls).toEqual([
      {
        fn: "loadString",
        input: expect.objectContaining({
          data: "model Circuit end Circuit;",
          filename: "/w/Demo.mo",
        }),
      },
    ]);
  });

  it("omits the filename for a class OMC cannot place", async () => {
    const mcp = await connect();
    sourceFile = "<interactive>";

    await mcp.callTool({
      name: "setSourceCode",
      arguments: { className: "Fresh", code: "model Fresh end Fresh;" },
    });

    const [only] = calls;
    expect(only?.fn).toBe("loadString");
    expect(only?.input).not.toHaveProperty("filename");
  });
});
