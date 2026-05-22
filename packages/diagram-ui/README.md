# @modelica-wrapper/diagram-ui

[Lit](https://lit.dev/) + [Babylon.js](https://www.babylonjs.com/) custom elements
(`<om-*>`) that render an interactive Modelica **graphical layout editor** in the
browser. Feed it a `DiagramLayout` from
[`@modelica-wrapper/omc-client`](https://www.npmjs.com/package/@modelica-wrapper/omc-client);
it draws the diagram in a WebGL scene, handles picking/selection/drag, and emits
DOM `CustomEvent`s for every gesture (move, connect, double-click, parameter
edit). It also ships the schema-driven parameter side-panel and the library
browser.

It is **host-agnostic** — it knows nothing about VSCode, OMC, or any transport. It
takes a layout in (as a property) and emits events out. That keeps it testable in
Storybook and embeddable anywhere.

> Part of the [modelica-wrapper](https://github.com/dicode-ayo/modelica-wrapper)
> monorepo, where it runs inside the extension's webview. See
> [diagram rendering](https://github.com/dicode-ayo/modelica-wrapper/blob/main/docs/diagram-rendering.md)
> and the [communication protocol](https://github.com/dicode-ayo/modelica-wrapper/blob/main/docs/protocol.md).

## Requirements

- A **browser environment** with WebGL (Babylon.js renders the scene).
- A **bundler** (Vite, esbuild, webpack, …). The package ships ESM + CSS
  side-effect imports and pulls in `@babylonjs/*`, `lit`, and `@awesome.me/webawesome`.

## Install

```sh
npm add @modelica-wrapper/diagram-ui @modelica-wrapper/omc-client
```

## Quick start

```ts
// 1. Register the WebAwesome theme bridge once at app startup:
import "@modelica-wrapper/ui-common/webawesome-setup";

// 2. Import the elements you use — importing registers the custom elements
//    (their @customElement decorators run on module load):
import { OmGraphicalLayout } from "@modelica-wrapper/diagram-ui";

// 3. Use the element and hand it a DiagramLayout:
const el = document.createElement("om-graphical-layout");
el.layout = layout;            // DiagramLayout from omc-client's producer
document.body.append(el);

el.addEventListener("om-graphical-layout-change", (e) => {
  // e.detail is the new layout after a move/resize/delete — persist it
});
el.addEventListener("om-connection-create", (e) => {
  const { fromKey, toKey, waypoints } = e.detail;
});
el.addEventListener("om-double-click", (e) => {
  // e.detail.key — open a parameter panel for the component, etc.
});
```

In a Lit/HTML template the same element is just:

```html
<om-graphical-layout .layout=${layout}></om-graphical-layout>
```

## Element catalog

| Element | Role |
| --- | --- |
| `<om-scene>` | Root: Babylon engine + camera (orthographic 2D / perspective 3D), pan/zoom, on-demand rendering. |
| `<om-graphical-layout>` | Orchestrator: renders a `DiagramLayout`, wires interaction, selection, and the parameter panel. |
| `<om-component>` / `<om-connector>` | A sub-component (textured icon plane) / a connector port. |
| `<om-connection>` / `<om-edge>` | Connection wires (orthogonally routed). |
| `<om-label>` | Text labels (names, value readouts). |
| `<om-rectangle>` `<om-polygon>` `<om-line>` `<om-ellipse>` `<om-text>` `<om-bitmap>` | The six shape primitives. |
| `<om-icon-provider>` | SVG → Babylon texture cache for component icons. |
| `<om-grid-axis>` | Grid + coordinate-system extent. |
| `<om-parameter-panel>` / `<om-parameter-form>` | Schema-driven parameter side drawer. |
| `<om-library-browser>` | Class picker for drag-to-place. |
| `<om-action-panel>` | Toolbar (undo / check / simulate / parameters). |
| `<om-multibody-root>` | MultiBody 3D preview root (experimental). |

## Events

`<om-graphical-layout>` emits these bubbling, composed `CustomEvent`s
(typed as `LayoutEvents`):

| Event | `detail` |
| --- | --- |
| `om-graphical-layout-change` | the new `DiagramLayout` |
| `om-connection-create` | `{ fromKey, toKey, waypoints }` |
| `om-selection-change` | `{ keys }` |
| `om-double-click` | `{ key }` |
| `om-context-menu` | context-menu target |
| `om-add-component-request` | `{ className, position }` |
| `om-resize` | resize details |

The parameter form (`<om-parameter-panel>` / `<om-parameter-form>`) emits
`om-panel-change`, `om-panel-submit`, `om-panel-cancel`, and `om-panel-reset`.

## Parameter panel

`<om-parameter-panel>` is a schema-driven side drawer: set its `schema`
(`JsonSchema`), `values`, `title`, `open`, and (optionally) `show-reset`, and it
renders one row per field — text/number/boolean/enum/array widgets, optional unit
dropdowns with affine conversion, `Dialog` tab/group layout, and `Dialog.enable`
gating. On submit it back-converts display units to base units and drops disabled
fields. The full flow is documented
[here](https://github.com/dicode-ayo/modelica-wrapper/blob/main/docs/parameter-panel.md).

## Styling

The look is driven by `--om-*` CSS custom properties defined in
[`src/base/om-tokens.ts`](src/base/om-tokens.ts) (spacing, radii, z-layers, form
control sizing, modal/drawer dimensions, typography, state opacities). They
inherit through the shadow DOM, so override any of them on a light-DOM ancestor:

```css
body { --om-space-md: 10px; --om-panel-drawer-size: 480px; }
```

## What it does *not* do

- It makes **no OMC calls** and holds **no model state** — the embedder owns the
  `DiagramLayout` and decides what to do with emitted events.
- It has **no undo** — layout-op helpers (`applyDeltaMove`, `applyRotate`,
  `applyDelete`, …) return *new* layouts; the embedder commits/records them.

## License

See the [repository](https://github.com/dicode-ayo/modelica-wrapper).
