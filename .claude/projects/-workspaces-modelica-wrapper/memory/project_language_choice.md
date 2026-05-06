---
name: Backend is TypeScript, in VSCode extension host (not Go, not Rust)
description: User chose TypeScript-in-extension-host on 2026-05-05; backend code lives inside the VSCode extension, not as a separate process
type: project
originSessionId: 02ed9633-dacb-4a1f-863c-f58b7f026daf
---
The "backend" for the modelica-wrapper VSCode extension is **TypeScript** running **inside the VSCode extension host process** (Node, provided by VSCode). There is no separate backend process and no JSON-RPC layer.

**History:**
1. README originally recommended Rust subprocess + JSON-RPC over stdio.
2. User initially chose Go subprocess (2026-05-05) — implemented project + ~75 OMC API wrappers + JSON-RPC server. Code lived under `backend/`.
3. Same day, user reconsidered: with OMSimulator/in-process FMU stepping declared out of scope, the FFI argument for Go collapsed (OMC handles the full simulate→.mat pipeline by itself). Switched to TypeScript-in-extension-host. Go code in `backend/` was deleted (untested, easy to redo).

**Why TypeScript-in-extension-host:**
- OMC alone runs the full simulation pipeline (`translateModel` → `buildModel` → `simulate` → `readSimulationResultVars` are all wrappable via ZMQ). No native code needs to live in our process.
- Single-language stack: extension activation, OMC client, webview all share types — no schema codegen.
- No JSON-RPC framing layer needed (entire `internal/rpc/` from the Go version goes away).
- VSCode already ships Node, so there is no additional runtime distribution cost.
- Trade-off accepted: backend crash takes the extension host with it (no isolation).

**How to apply:**
- All TypeScript code lives under `extension/src/`. The OMC client lives at `extension/src/omc/`.
- Use `zeromq` npm package (N-API native bindings) for ZMQ to OMC.
- Do NOT propose JSON-RPC, stdio framing, subprocess backend, or schema codegen — that architecture is gone.
- Do NOT propose Rust or Go for any part of this project.
- If FMU stepping / OMSimulator / SSP composition becomes in-scope later, the option of a small native sidecar (Rust or Go) is open — but for now, OMC is the only out-of-process dependency.
- Modelica response parser, OMC API wrappers (`getClassNames`, `getComponents`, etc.), and Promise-based serialization all live in plain TypeScript modules.
