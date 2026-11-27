# @dicode/modelica-mcp

The MCP tool surface over the OpenModelica scripting API: the curated
OMEdit-parity tools, the shape and source tools, `omc_invoke` for the rest, and
a write gate in front of every mutating call. No VSCode dependency.

Two hosts stand it up:

- the **VSCode extension**, which serves it over loopback HTTP from inside the
  extension host, against the OMC the editor window already drives;
- the **`modelica-mcp` bin**, which serves the same tool set over stdio with an
  OMC of its own, for a CI job, a headless agent, or a bug reproduced without
  an editor.

## Standalone (stdio)

### Build and run

From the repo:

```sh
pnpm install
pnpm --filter @dicode/modelica-mcp build
node packages/mcp-server/dist/cli.js --root path/to/models
```

From the published package, the bin is `modelica-mcp`:

```sh
npx @dicode/modelica-mcp --root path/to/models
```

`omc` must be on `PATH`. It is spawned on the first tool call, not at startup,
so `initialize` and `tools/list` answer without it.

### Arguments

| Argument       | Default           | Meaning                                                                                                                                          |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--root <dir>` | current directory | The source tree `createClass` writes new classes into (directories are created as needed). OMC's working directory is parked at `<dir>/.modelica`, so simulation artifacts land there. |
| `-h, --help`   |                   | Print usage and exit.                                                                                                                            |

Any other argument is rejected with exit code 2.

### Streams and shutdown

stdout carries MCP frames and nothing else; every log line (`[info] …`,
`[warn] …`) goes to stderr. The server shuts down, closing its OMC if it spawned
one, when stdin ends or on `SIGINT` / `SIGTERM`.

### The write gate

There is no user to ask, so the gate is not allow-all. It refuses what the
extension refuses, on OMC's and the filesystem's evidence alone:

- a class whose source file lies under a `MODELICAPATH` entry — a system
  library, read-only however its files are permissioned. The first
  `MODELICAPATH` an OMC session reports is the one used for the session's
  lifetime, so a later `setModelicaPath` cannot make a loaded library writable;
- a class whose source file OMC reports as read-only (`fileReadOnly`).

A refusal reads like `Cannot edit Modelica.Blocks.Math.Sin — it belongs to a
read-only system library.` If OMC cannot answer the lookup, the call is
allowed, as in the extension.

### Its own OMC

The CLI spawns a private `omc`. It cannot see classes an editor window has
loaded — those live in that window's OMC — and nothing it loads or edits
appears in an editor's sidebar or diagram until it is saved to disk and the
editor reloads it.

### Client configuration

Any MCP client that launches a stdio server:

```json
{
  "mcpServers": {
    "modelica": {
      "command": "node",
      "args": [
        "/abs/path/to/modelica-wrapper/packages/mcp-server/dist/cli.js",
        "--root",
        "/abs/path/to/models"
      ]
    }
  }
}
```

## Embedding

`createMcpHttpHost` and `createStdioHost` are exported for other hosts, along
with the pieces the stdio host is built from (`createFsWriteVerdicts`,
`fsSourceWriter`, `streamLog`). A host supplies a way to reach OMC
(`ensureClient`), a `WriteVerdictSource`, optionally a source tree, and a log.
