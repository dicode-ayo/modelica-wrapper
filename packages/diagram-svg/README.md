# @dicode/diagram-svg

Render Modelica icon/diagram graphics to **self-contained SVG strings**. Give it
the typed `IconLayer[]` shape graphics emitted by
[`@dicode/omc-client`](https://www.npmjs.com/package/@dicode/omc-client)'s
`DiagramLayout` producer, get back a complete `<svg>` document you can drop into
any HTML container, write to disk, or rasterize into a texture.

Pure, dependency-light, and isomorphic — it builds a string, so it runs in Node
or the browser with no DOM.

> Part of the [modelica-wrapper](https://github.com/dicode-ayo/modelica-wrapper)
> monorepo. See [diagram rendering](https://github.com/dicode-ayo/modelica-wrapper/blob/main/docs/diagram-rendering.md).

## Install

```sh
npm add @dicode/diagram-svg @dicode/omc-client
```

## Quick start

```ts
import { OmcClient, diagram } from "@dicode/omc-client";
import { renderIconLayersToSvg } from "@dicode/diagram-svg";

const client = await OmcClient.create();
const { instance } = await client.getModelInstance({
  typeName: "Modelica.Electrical.Analog.Basic.Resistor",
});
const layout = diagram.produceDiagramLayout(instance, "icon");

const svg = renderIconLayersToSvg(layout.iconLayers, {
  coordinateSystem: layout.coordinateSystem,
  background: "white",
});
// → "<svg xmlns='…' viewBox='…'>…</svg>"
```

The returned string is a complete SVG document: a `viewBox`, the root
`scale(1,-1)` y-flip (Modelica is +Y-up, SVG is +Y-down), and one
`<g class="diagram-svg-layer">` per inheritance layer.

## API

### `renderIconLayersToSvg(layers, options?)`

Renders an `IconLayer[]` to an SVG string.

| Option | Default | Meaning |
| --- | --- | --- |
| `coordinateSystem` | `[[-100,-100],[100,100]]` | Modelica extent driving the viewBox. |
| `size` | intrinsic | `number` or `{ width, height }` CSS pixels. |
| `background` | none | Fill color for a background rect (e.g. `"white"`). |
| `expandViewBoxToShapes` | `false` | Grow the viewBox to fit shapes beyond the coordinate system. |
| `lineThicknessScale` | `10` | Stroke-width multiplier (spec thicknesses are tiny). |

### `renderClassIconToSvg(classDef, options?)`

Convenience wrapper that renders a `ClassDef`'s icon directly.

### `computeIconBounds(layers, coordinateSystem?)`

Returns the union of the coordinate-system extent and all shape extents — handy
for layout/measuring without rendering.

### Reusable mappers

For building a custom renderer (Canvas, React, etc.), the internal mappers are
exported too:

```ts
import {
  colorToCss,             // Color → "rgb(…)" / "rgba(…)"
  linePatternToDashArray, // LinePattern → stroke-dasharray
  expressionToString,     // Expression AST → literal string
  interpolateTemplate,    // %name / %class / %<param> substitution
} from "@dicode/diagram-svg";
```

## Supported primitives

All six Modelica shape primitives (Modelica spec §18.6):

| Primitive | SVG | Notes |
| --- | --- | --- |
| Line | `<polyline>` | stroke + optional dashes |
| Polygon | `<polygon>` | filled + stroked |
| Rectangle | `<rect>` | optional rounded corners |
| Ellipse | `<ellipse>` | bounding ellipse |
| Text | `<text>` | font/alignment; counter-transformed to stay upright |
| Bitmap | `<image>` | base64 PNG or file path |

Cylinder and sphere fills are emitted as gradient `<defs>`. Each shape's own
`visible` / `origin` / `rotation` (the `GraphicItem` fields) are honored.

## Types

The shape types it consumes (`IconLayer`, `Shape`, `ClassDef`,
`CoordinateSystem`, …) are re-exported so you don't need a separate type import:

```ts
import type { IconLayer, Shape, CoordinateSystem } from "@dicode/diagram-svg";
```

## License

See the [repository](https://github.com/dicode-ayo/modelica-wrapper).
