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
  audited against a specific OMC version; nearby `1.27.x` releases work too.
- **VSCode ≥ 1.95**.

The extension does **not** bundle OpenModelica — it drives your local `omc`
install as a subprocess.

## Features

- **Library browser** — an activity-bar view of loaded libraries with search and
  lazy-rendered icon thumbnails. Loads the installed Modelica Standard Library,
  any library in a `modelica.modelicaPath` directory by name, or a library by
  path. Right-click a row for View
  Source, and a package row for New Class / Save Package As.
- **Diagram editor** — open any class as a Babylon.js-rendered diagram:
  - drag a class from the library onto the canvas to instantiate it
  - draw, move, and delete connections
  - move/resize/rotate components
  - diagram-local **undo**
  - right-click a component for **Open Diagram**, which opens that
    component's class in its own diagram editor (listed above Go to
    Definition / Go to Declaration; **F12** still opens source)
- **Parameter panels** — double-click a component (or use the toolbar for
  class-level params) to edit parameters in a floating panel, with **live unit
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

Every workspace folder loads into one OpenModelica session, so each top-level class is loaded from one file only. When the workspace loads (at startup and after `:reset`), entry files that declare the same top-level class load only once: the first copy found that loads, earlier workspace folders first. The others are not loaded, and you get a warning naming the files.

The same rule holds until the next `:reset`. Saving or creating a file that declares a top-level class another file already supplies, opening it in an editor, or editing a file inside a refused copy's package (or a `within` file beside that copy, or a duplicate `within` file the workspace load refused) leaves the loaded copy in place, and you are warned once per file. Editing or deleting a refused copy never unloads the loaded copy. Renaming the loaded copy's file keeps it loaded under the new name. Once the loaded copy's file is deleted, or edited to stop declaring the class, the class is free and you are told which copies are not loaded; the next save of one of them loads it, and an editor open on one picks it up on its next hover. Files saved or opened while the workspace is still loading wait for it to finish, so they never take a class from the copy it keeps.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `modelica.omcPath` | `""` | Path to the `omc` binary. Empty uses `omc` from `PATH`. |
| `modelica.modelicaPath` | `[]` | Extra directories OMC searches for libraries, in addition to the installed ones. Relative entries resolve against each workspace folder. The installed libraries are searched after these, so an entry adds libraries but cannot replace the Modelica Standard Library; classes loaded from these directories stay editable. A leading `~` is your home directory. Applied when OMC starts (including after `:reset`) and again whenever the setting changes. |
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

Then launch the **Run Extension** target from VSCode, or `pnpm host` from the
repo root for the same window from a terminal, or package with `vsce`.
After editing the webview UI, rebuild and reload the window — the webview bundle is
not hot-reloaded.

## License

See the [repository](https://github.com/dicode-ayo/modelica-wrapper). OpenModelica
is OSMC-PL / GPL dual-licensed and is installed separately, not bundled.
