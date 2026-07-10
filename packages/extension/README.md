# Modelica for VSCode

A graphical model editor and simulation runner for [Modelica](https://modelica.org/),
backed by [OpenModelica](https://openmodelica.org/). Browse a library, open a class
as an interactive **diagram**, drag in components, draw connections, edit
parameters with live unit conversion, run a semantic check or a simulation — and
every gesture is written straight back into the `.mo` source.

> This is the VSCode extension of the
> [modelica-wrapper](https://github.com/dicode-ayo/modelica-wrapper) project. The
> reusable building blocks are published separately:
> [`@dicode/omc-client`](https://www.npmjs.com/package/@dicode/omc-client),
> [`@dicode/diagram-ui`](https://www.npmjs.com/package/@dicode/diagram-ui),
> and [`@dicode/diagram-svg`](https://www.npmjs.com/package/@dicode/diagram-svg).

## Requirements

- **OpenModelica installed** with `omc` on your `PATH` (or set `modelica.omcPath`).
  Get it from <https://openmodelica.org/download/>. The extension is built and
  audited against a specific OMC version; nearby `1.26.x` releases work too.
- **VSCode ≥ 1.95**.

The extension does **not** bundle OpenModelica — it drives your local `omc`
install as a subprocess.

## Features

- **Library browser** — an activity-bar view of loaded libraries with search and
  lazy-rendered icon thumbnails. Loads the Modelica Standard Library from your
  `MODELICAPATH`, or any library by name/path. Right-click a row for View
  Source, and a package row for New Class / Save Package As.
- **Diagram editor** — open any class as a Babylon.js-rendered diagram:
  - drag a class from the library onto the canvas to instantiate it
  - draw, move, and delete connections
  - move/resize/rotate components
  - diagram-local **undo**
- **Parameter panels** — double-click a component (or use the toolbar for
  class-level params) to edit parameters in a side drawer, with **live unit
  conversion** + unit dropdowns, `Dialog` tab/group layout, `Dialog.enable`
  gating, and a **Reset to defaults** button. Inherited parameters are routed to
  the correct base class.
- **Check Model** — a one-click semantic check that surfaces compile diagnostics
  in the Problems panel, plus optional debounced auto-check on edit.
- **Simulate** — run a simulation from the diagram toolbar with results
  post-processing.
- **Modelica REPL** — an interactive `omc` terminal, with history, completion, and
  a programmatic exec command.

## Commands

| Command | Title |
| --- | --- |
| `modelica.openDiagram` | Open Diagram |
| `modelica.diagram.undo` | Undo Diagram Edit |
| `modelica.checkModel` | Check Model |
| `modelica.viewSource` | View Source |
| `modelica.loadLibrary` | Load Library… |
| `modelica.createClass` | New Class… |
| `modelica.savePackage` | Save Package As… |
| `modelica.tree.refresh` | Refresh Libraries |
| `modelica.openRepl` | Open REPL |
| `modelica.getOmcVersion` | Show OMC Version |
| `modelica.showLogs` | Show Logs |

The extension activates when a workspace contains any `*.mo` file.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `modelica.omcPath` | `""` | Path to the `omc` binary. Empty uses `omc` from `PATH`. |
| `modelica.checkOnEdit` | `true` | Run a debounced semantic check on each edit and surface diagnostics. |
| `modelica.checkDebounceMs` | `750` | Debounce window (ms) before the auto-check runs (min 250). |

## How it works

The extension host links [`@dicode/omc-client`](https://www.npmjs.com/package/@dicode/omc-client)
in-process and drives a single long-lived `omc` subprocess over ZeroMQ. The
interactive diagram runs in a sandboxed webview (built from
[`@dicode/diagram-ui`](https://www.npmjs.com/package/@dicode/diagram-ui))
and talks to the host over a typed `postMessage` protocol. The full design:

- [Architecture](https://github.com/dicode-ayo/modelica-wrapper/blob/main/docs/architecture.md)
- [Communication protocol](https://github.com/dicode-ayo/modelica-wrapper/blob/main/docs/protocol.md)
- [Parameter panel — deep dive](https://github.com/dicode-ayo/modelica-wrapper/blob/main/docs/parameter-panel.md)

## Building from source

```sh
pnpm install
pnpm --filter modelica-wrapper build     # esbuild bundle → out/
```

Then launch the **Run Extension** target from VSCode, or package with `vsce`.
After editing the webview UI, rebuild and reload the window — the webview bundle is
not hot-reloaded.

## License

See the [repository](https://github.com/dicode-ayo/modelica-wrapper). OpenModelica
is OSMC-PL / GPL dual-licensed and is installed separately, not bundled.
