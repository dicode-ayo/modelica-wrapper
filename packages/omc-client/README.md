# @modelica-wrapper/omc-client

A typed, schema-validated TypeScript client for [OpenModelica](https://openmodelica.org/)'s
interactive **ZeroMQ scripting API**. It spawns and drives an `omc` subprocess,
parses OMC's Modelica-syntax responses into a typed AST, and exposes ~200
Zod-validated wrappers over the scripting functions — plus a pure producer that
turns `getModelInstance` into a renderer-agnostic diagram layout.

No VSCode dependency. Works in any Node ≥20 process.

> Part of the [modelica-wrapper](https://github.com/dicode-ayo/modelica-wrapper)
> monorepo. See the repo for the [architecture](https://github.com/dicode-ayo/modelica-wrapper/blob/main/docs/architecture.md)
> and [client internals](https://github.com/dicode-ayo/modelica-wrapper/blob/main/docs/omc-client.md).

## Requirements

- **Node ≥ 20**
- **`omc` on your `PATH`** (or pass an explicit path) — install
  [OpenModelica](https://openmodelica.org/download/). The client is pinned to and
  audited against a specific OMC version (see [`src/version.ts`](src/version.ts));
  other `1.26.x` releases are treated as compatible.
- ZeroMQ is used under the hood via the prebuilt-binary [`zeromq`](https://www.npmjs.com/package/zeromq) package.

## Install

```sh
npm add @modelica-wrapper/omc-client
# or: pnpm add … / yarn add …
```

## Quick start

```ts
import { OmcClient } from "@modelica-wrapper/omc-client";

const client = await OmcClient.create();          // spawns `omc --interactive=zmq`
try {
  const { version } = await client.getVersion();
  console.log(version);                            // "OpenModelica 1.26.7"

  await client.loadModel({ typeName: "Modelica" });

  const info = await client.getClassInformation({
    typeName: "Modelica.Blocks.Math.Sin",
  });
  console.log(info);
} finally {
  await client.close();                            // quit OMC, close socket, kill subprocess
}
```

`OmcClient.create(options?)` accepts:

| Option | Default | Meaning |
| --- | --- | --- |
| `omcPath` | `"omc"` from `PATH` | Path to the `omc` binary. |
| `callTimeoutMs` | `60000` | Per-call timeout in ms; `0` disables it. |

Every call is serialized through a promise-chain mutex (OMC is single-threaded),
so you can fire calls concurrently and they'll queue safely.

## Three ways to call

### 1. Dedicated typed methods (most callers)

```ts
const { classNames } = await client.getClassNames({ typeName: "Modelica.Blocks" });
const { instance }   = await client.getModelInstance({ typeName: "MyPkg.MyModel" });
```

TypeScript narrows the input and return type per function; the output is
Zod-validated against the function's schema.

### 2. Generic dispatcher (untrusted input)

When the function name and input come from a boundary (RPC, CLI, config, plugin),
use `invoke` — it validates the **input** against the function's Zod schema too:

```ts
const { version } = await client.invoke("getVersion", {});
const info = await client.invoke("getClassInformation", {
  typeName: "Modelica.Blocks.Math.Sin",
});
```

### 3. Functional API (tree-shakable)

Each wrapper is also a standalone function taking a `CallContext` you supply —
useful for composing your own runtime or trimming bundle size:

```ts
import { getVersion } from "@modelica-wrapper/omc-client/api/browsing";

const result = await getVersion(myCtx, {});  // myCtx implements CallContext
```

The namespaced barrels are also re-exported from the package root:
`browsing`, `contents`, `diagram`, `editing`, `elements`, `execution`,
`library`, `lifecycle`, `parameters`, `results`, `solver`.

## What's wrapped

~200 functions across 11 categories:

| Category | Covers |
| --- | --- |
| `browsing` | class existence, metadata, inheritance tree, `is*` predicates |
| `contents` | components, connections, **`getModelInstance`**, units (`getDerivedUnits`, `convertUnits`) |
| `diagram` | the `produceDiagramLayout` producer + placement/shape helpers (pure, no OMC) |
| `editing` | `addComponent`, `deleteComponent`, `updateComponent`, `add/deleteConnection`, `updateConnection(Names)` |
| `elements` | modern element access — `setElementModifierValue`, `removeElementModifiers`, `setElementAnnotation` |
| `execution` | `checkModel`, `simulate`, `getSimulationOptions`, … |
| `library` | load/search + package manager (some network-gated) |
| `lifecycle` | `loadFile`, `loadString`, `listFile`, `getSourceFile`, `newModel`, … |
| `parameters` | component & extends modifiers, derived-class readers |
| `results` | reading `.mat` / CSV simulation results |
| `solver` | solver / jacobian / tearing method getters & setters |

Coverage is tracked function-by-function against a real OMC in
[`docs/coverage.md`](docs/coverage.md); the re-audit runbook is
[`docs/audit.md`](docs/audit.md).

## Diagram layout producer

`getModelInstance` returns the whole elaborated class as JSON (inheritance already
walked). `produceDiagramLayout` turns that AST into a renderer-agnostic
`DiagramLayout` with **no further OMC calls** — feed it to
[`@modelica-wrapper/diagram-svg`](https://www.npmjs.com/package/@modelica-wrapper/diagram-svg)
or any renderer of your own:

```ts
import { OmcClient, diagram } from "@modelica-wrapper/omc-client";

const client = await OmcClient.create();
const { instance } = await client.getModelInstance({ typeName: "MyPkg.Circuit" });
const layout = diagram.produceDiagramLayout(instance, "diagram");
// layout.iconLayers / .components / .connectors / .connections / …
```

## Parsing OMC responses directly

OMC answers in Modelica syntax, not JSON. The recursive-descent parser is exported
for advanced use:

```ts
import { parse, asString, asList } from "@modelica-wrapper/omc-client";

const value = parse('{"a", "b", true, 42}');   // tagged-union Value tree
```

## Version compatibility

```ts
const report = await client.getVersionStatus();
// { level: "exact" | "minor-compatible" | "untested" | "unparseable", … }
```

`SUPPORTED_OMC`, `parseOmcVersion`, and `compatibilityReport` are exported if you
want to gate behaviour on the runtime OMC version yourself.

## Testing

```sh
pnpm test            # unit tests; integration tests run when `omc` is on PATH
```

The integration suite auto-skips when `omc` isn't found, so unit tests run
anywhere.

## License

See the [repository](https://github.com/dicode-ayo/modelica-wrapper). OpenModelica
itself is OSMC-PL / GPL dual-licensed and is **not** bundled — you install it
separately.
