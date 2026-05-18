/**
 * Unit tests for the SVG renderer. We construct minimal `IconLayer[]`
 * fixtures inline rather than driving them through the OMC producer —
 * the producer has its own integration coverage upstream, and pinning
 * this layer to handcrafted shapes keeps the tests fast and the failure
 * messages obvious.
 *
 * Assertions are substring-based. SVG element ordering and exact
 * attribute ordering should stay stable enough that this is easier to
 * read than parsing into a DOM, and we avoid pulling in JSDOM /
 * linkedom just for the test runner.
 */

import { describe, expect, it } from "vitest";

import {
  renderClassIconToSvg,
  renderIconLayersToSvg,
} from "./render.js";
import type {
  ClassDef,
  IconLayer,
  RectangleShape,
} from "./index.js";

const RED: [number, number, number] = [255, 0, 0];

function makeLayer(from: string, shapes: IconLayer["shapes"]): IconLayer {
  return { from, shapes };
}

describe("renderIconLayersToSvg", () => {
  it("returns a well-formed <svg> for empty input with the default viewBox", () => {
    const svg = renderIconLayersToSvg([]);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    // Default Modelica extent is [[-100,-100],[100,100]] -> viewBox
    // origin x=-100, width=200, after y-flip origin y=-100, height=200.
    expect(svg).toContain('viewBox="-100 -100 200 200"');
    expect(svg).toContain('<g transform="scale(1,-1)">');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("renders a rectangle with extent + colour mapped to <rect>", () => {
    const svg = renderIconLayersToSvg([
      makeLayer("Test.Foo", [
        {
          kind: "rectangle",
          extent: [
            [-50, -25],
            [50, 25],
          ],
          fillColor: RED,
        },
      ]),
    ]);
    expect(svg).toContain("<rect");
    expect(svg).toContain('x="-50"');
    expect(svg).toContain('y="-25"');
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="50"');
    expect(svg).toContain('fill="rgb(255,0,0)"');
    // Default stroke when no lineColor specified.
    expect(svg).toContain('stroke="rgb(0,0,0)"');
  });

  it("renders a defensively-ordered rectangle extent into width/height min/max", () => {
    const svg = renderIconLayersToSvg([
      makeLayer("Test.Reverse", [
        {
          kind: "rectangle",
          extent: [
            [50, -50],
            [-50, 50],
          ],
        } satisfies RectangleShape,
      ]),
    ]);
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="100"');
    expect(svg).toContain('x="-50"');
    expect(svg).toContain('y="-50"');
  });

  it("renders an ellipse with cx/cy/rx/ry derived from extent", () => {
    const svg = renderIconLayersToSvg([
      makeLayer("Test.Ell", [
        {
          kind: "ellipse",
          extent: [
            [-30, -10],
            [30, 10],
          ],
        },
      ]),
    ]);
    expect(svg).toContain("<ellipse");
    expect(svg).toContain('cx="0"');
    expect(svg).toContain('cy="0"');
    expect(svg).toContain('rx="30"');
    expect(svg).toContain('ry="10"');
  });

  it("renders a polygon and preserves point order verbatim", () => {
    // Triangle pointing UP in Modelica: apex at (0, 50), base on y=0.
    const svg = renderIconLayersToSvg([
      makeLayer("Test.Tri", [
        {
          kind: "polygon",
          points: [
            [-50, 0],
            [50, 0],
            [0, 50],
          ],
          fillColor: [0, 128, 255],
        },
      ]),
    ]);
    expect(svg).toContain("<polygon");
    expect(svg).toContain('points="-50,0 50,0 0,50"');
    // The visual flip happens via the root scale(1,-1) — coords stay as-is.
    expect(svg).toContain('<g transform="scale(1,-1)">');
    // viewBox y component is computed from -y2 (== -100 here, default ext).
    expect(svg).toContain('viewBox="-100 -100 200 200"');
    expect(svg).toContain('fill="rgb(0,128,255)"');
  });

  it("renders a line as <polyline> with stroke + dasharray", () => {
    const svg = renderIconLayersToSvg([
      makeLayer("Test.Wire", [
        {
          kind: "line",
          points: [
            [0, 0],
            [10, 10],
          ],
          color: RED,
          pattern: "Dash",
          thickness: 2,
        },
      ]),
    ]);
    expect(svg).toContain("<polyline");
    expect(svg).toContain('points="0,0 10,10"');
    expect(svg).toContain('stroke="rgb(255,0,0)"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke-dasharray="8 4"');
    // Explicit `thickness: 2` × default `lineThicknessScale: 10` = 20.
    // The scale applies uniformly to spec-default AND explicit values
    // so the relative weight of one shape vs another stays intact.
    expect(svg).toContain('stroke-width="20"');
  });

  it("lineThicknessScale: 1 renders strokes at the raw annotation values", () => {
    const svg = renderIconLayersToSvg(
      [
        makeLayer("Test.Wire", [
          {
            kind: "line",
            points: [
              [0, 0],
              [10, 10],
            ],
            color: [0, 0, 0],
            thickness: 2,
          },
        ]),
      ],
      { lineThicknessScale: 1 },
    );
    expect(svg).toContain('stroke-width="2"');
  });

  it("uses the bumped spec-default (1.25 × 10 = 12.5) when thickness is omitted", () => {
    // SPEC_DEFAULT_THICKNESS = 0.25 × 5 (lifted from the literal
    // Modelica default so unspecified strokes stay legible at typical
    // zoom). DEFAULT_LINE_THICKNESS_SCALE = 10 then multiplies it.
    // The multiplier also applies to explicit annotation values.
    const svg = renderIconLayersToSvg([
      makeLayer("Test.Wire", [
        {
          kind: "line",
          points: [
            [0, 0],
            [10, 10],
          ],
          color: [0, 0, 0],
        },
      ]),
    ]);
    expect(svg).toContain('stroke-width="12.5"');
  });

  it("renders a text shape using the literal textString", () => {
    const svg = renderIconLayersToSvg([
      makeLayer("Test.Label", [
        {
          kind: "text",
          extent: [
            [-50, -10],
            [50, 10],
          ],
          textString: "hello",
          textColor: [10, 20, 30],
          fontSize: 14,
        },
      ]),
    ]);
    expect(svg).toContain("<text");
    expect(svg).toContain(">hello</text>");
    expect(svg).toContain('font-size="14"');
    expect(svg).toContain('fill="rgb(10,20,30)"');
    expect(svg).toContain('text-anchor="middle"');
  });

  it("resolves DynamicSelect text to its static default", () => {
    const svg = renderIconLayersToSvg([
      makeLayer("Test.Dyn", [
        {
          kind: "text",
          extent: [
            [-50, -10],
            [50, 10],
          ],
          textString: {
            $kind: "call",
            name: "DynamicSelect",
            arguments: [
              "fallback",
              { $kind: "cref", parts: [{ name: "x" }] },
            ],
          },
        },
      ]),
    ]);
    expect(svg).toContain(">fallback</text>");
  });

  it("renders a bitmap with a base64 PNG imageSource as a data URI", () => {
    const svg = renderIconLayersToSvg([
      makeLayer("Test.Pic", [
        {
          kind: "bitmap",
          extent: [
            [-25, -25],
            [25, 25],
          ],
          imageSource: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZmTHc8AAAAASUVORK5CYII=",
        },
      ]),
    ]);
    expect(svg).toContain("<image");
    expect(svg).toContain("data:image/png;base64,iVBOR");
    expect(svg).toContain('width="50"');
    expect(svg).toContain('height="50"');
  });

  it("falls back to fileName when imageSource is absent", () => {
    const svg = renderIconLayersToSvg([
      makeLayer("Test.PicFile", [
        {
          kind: "bitmap",
          extent: [
            [0, 0],
            [10, 10],
          ],
          fileName: "modelica://Foo/icon.png",
        },
      ]),
    ]);
    expect(svg).toContain('href="modelica://Foo/icon.png"');
  });

  it("maps fillPattern=None to fill=none even with a fillColor present", () => {
    const svg = renderIconLayersToSvg([
      makeLayer("Test.Hollow", [
        {
          kind: "polygon",
          points: [
            [-10, -10],
            [10, -10],
            [10, 10],
          ],
          fillColor: RED,
          fillPattern: "None",
        },
      ]),
    ]);
    expect(svg).toContain('fill="none"');
    expect(svg).not.toContain('fill="rgb(255,0,0)"');
  });

  it("emits one <g> per layer, in input order, with the from attribute", () => {
    const svg = renderIconLayersToSvg([
      makeLayer("Ancestor.Frame", [
        {
          kind: "rectangle",
          extent: [
            [-100, -100],
            [100, 100],
          ],
        },
      ]),
      makeLayer("Host.Leaf", [
        {
          kind: "ellipse",
          extent: [
            [-25, -25],
            [25, 25],
          ],
        },
      ]),
    ]);
    const ancestorIdx = svg.indexOf('data-from="Ancestor.Frame"');
    const hostIdx = svg.indexOf('data-from="Host.Leaf"');
    expect(ancestorIdx).toBeGreaterThan(-1);
    expect(hostIdx).toBeGreaterThan(-1);
    expect(ancestorIdx).toBeLessThan(hostIdx);
  });

  it("uses the last layer's coordinateSystem when no override is given", () => {
    const svg = renderIconLayersToSvg([
      {
        from: "Ancestor",
        shapes: [],
        coordinateSystem: { extent: [[-50, -50], [50, 50]] },
      },
      {
        from: "Host",
        shapes: [],
        coordinateSystem: { extent: [[-200, -200], [200, 200]] },
      },
    ]);
    expect(svg).toContain('viewBox="-200 -200 400 400"');
  });

  it("emits width/height when size is supplied", () => {
    const svgN = renderIconLayersToSvg([], { size: 64 });
    expect(svgN).toContain('width="64"');
    expect(svgN).toContain('height="64"');

    const svgWH = renderIconLayersToSvg([], {
      size: { width: 100, height: 50 },
    });
    expect(svgWH).toContain('width="100"');
    expect(svgWH).toContain('height="50"');
  });

  it("emits a background <rect> covering the viewBox when background is set", () => {
    const svg = renderIconLayersToSvg([], { background: "white" });
    // Background lives BEFORE the y-flip group so it cleanly covers the
    // viewBox area without inheriting the flip.
    const bgIdx = svg.indexOf('<rect');
    const flipIdx = svg.indexOf('<g transform="scale(1,-1)">');
    expect(bgIdx).toBeGreaterThan(-1);
    expect(bgIdx).toBeLessThan(flipIdx);
    expect(svg).toContain('fill="white"');
  });
});

describe("renderClassIconToSvg", () => {
  it("renders the class's iconLayers and uses its coordinateSystem", () => {
    const cls: ClassDef = {
      name: "Synth.Host",
      iconLayers: [
        {
          from: "Synth.Host",
          shapes: [
            {
              kind: "rectangle",
              extent: [
                [-50, -50],
                [50, 50],
              ],
              fillColor: [0, 200, 0],
            },
          ],
        },
      ],
      coordinateSystem: { extent: [[-150, -150], [150, 150]] },
    };
    const svg = renderClassIconToSvg(cls);
    expect(svg).toContain('viewBox="-150 -150 300 300"');
    expect(svg).toContain('data-from="Synth.Host"');
    expect(svg).toContain('fill="rgb(0,200,0)"');
  });

  it("respects an explicit RenderOptions.coordinateSystem override", () => {
    const cls: ClassDef = {
      name: "Synth.Host",
      iconLayers: [],
      coordinateSystem: { extent: [[-150, -150], [150, 150]] },
    };
    const svg = renderClassIconToSvg(cls, {
      coordinateSystem: { extent: [[-10, -10], [10, 10]] },
    });
    expect(svg).toContain('viewBox="-10 -10 20 20"');
  });
});

describe("gradient fill patterns", () => {
  function withGradientRect(
    fillPattern: string,
    fillColor: [number, number, number] = [192, 192, 192],
    lineColor: [number, number, number] | undefined = [64, 64, 64],
  ): string {
    const shape: RectangleShape = {
      kind: "rectangle",
      extent: [
        [-50, -25],
        [50, 25],
      ],
      fillColor,
      fillPattern,
      ...(lineColor !== undefined ? { lineColor } : {}),
    };
    return renderIconLayersToSvg([makeLayer("Test.Cyl", [shape])]);
  }

  it("HorizontalCylinder emits a <linearGradient> with vertical axis and references it via url(#…)", () => {
    const svg = withGradientRect("HorizontalCylinder");
    // Linear gradient with vertical axis: x1=y1=x2=0, y2=1.
    expect(svg).toMatch(/<linearGradient id="dsvg-hcyl-[^"]+" x1="0" y1="0" x2="0" y2="1">/);
    // Three stops: edge (lineColor), middle (fillColor), edge.
    expect(svg).toContain('<stop offset="0%" stop-color="rgb(64,64,64)"/>');
    expect(svg).toContain('<stop offset="50%" stop-color="rgb(192,192,192)"/>');
    expect(svg).toContain('<stop offset="100%" stop-color="rgb(64,64,64)"/>');
    // Rectangle references the gradient rather than the solid fillColor.
    expect(svg).toMatch(/<rect [^>]*fill="url\(#dsvg-hcyl-[^"]+\)"/);
    // Gradient def lives inside <defs>, before the layer group.
    const defsIdx = svg.indexOf("<defs>");
    const layerIdx = svg.indexOf('class="diagram-svg-layer"');
    expect(defsIdx).toBeGreaterThan(-1);
    expect(defsIdx).toBeLessThan(layerIdx);
  });

  it("VerticalCylinder emits a <linearGradient> with horizontal axis", () => {
    const svg = withGradientRect("VerticalCylinder");
    expect(svg).toMatch(/<linearGradient id="dsvg-vcyl-[^"]+" x1="0" y1="0" x2="1" y2="0">/);
    expect(svg).toMatch(/<rect [^>]*fill="url\(#dsvg-vcyl-[^"]+\)"/);
  });

  it("Sphere emits a <radialGradient> from middle (fillColor) to edge (lineColor)", () => {
    const svg = withGradientRect("Sphere");
    expect(svg).toMatch(/<radialGradient id="dsvg-sphere-[^"]+" cx="0.5" cy="0.5" r="0.5">/);
    // For sphere: 0% = middle, 100% = edge (the brighter colour radiates out).
    expect(svg).toMatch(
      /<radialGradient[^>]*>\s*<stop offset="0%" stop-color="rgb\(192,192,192\)"\/>\s*<stop offset="100%" stop-color="rgb\(64,64,64\)"\/>/,
    );
  });

  it("dedupes gradient defs across shapes that share (kind, edge, middle)", () => {
    const svg = renderIconLayersToSvg([
      makeLayer("Test.Multi", [
        {
          kind: "rectangle",
          extent: [[-50, -25], [50, 25]],
          fillColor: [192, 192, 192],
          lineColor: [64, 64, 64],
          fillPattern: "HorizontalCylinder",
        },
        {
          kind: "rectangle",
          extent: [[60, -25], [160, 25]],
          fillColor: [192, 192, 192],
          lineColor: [64, 64, 64],
          fillPattern: "HorizontalCylinder",
        },
      ]),
    ]);
    // Exactly one <linearGradient> def even though two rects use it.
    const matches = svg.match(/<linearGradient /g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("falls back to a darkened fillColor when lineColor is absent", () => {
    // Inline the shape so no default lineColor sneaks in via the helper's
    // default parameter (JS resolves `undefined` to the default).
    const svg = renderIconLayersToSvg([
      makeLayer("Test.NoLine", [
        {
          kind: "rectangle",
          extent: [
            [-50, -25],
            [50, 25],
          ],
          fillColor: [200, 100, 50],
          fillPattern: "HorizontalCylinder",
        },
      ]),
    ]);
    // 50% of each fillColor channel: [100, 50, 25].
    expect(svg).toContain('<stop offset="0%" stop-color="rgb(100,50,25)"/>');
    expect(svg).toContain('<stop offset="50%" stop-color="rgb(200,100,50)"/>');
  });

  it("omits gradient defs entirely when no shape uses a gradient fill", () => {
    const svg = renderIconLayersToSvg([
      makeLayer("Test.Plain", [
        {
          kind: "rectangle",
          extent: [[-50, -25], [50, 25]],
          fillColor: [10, 20, 30],
          fillPattern: "Solid",
        },
      ]),
    ]);
    expect(svg).not.toContain("<defs>");
    expect(svg).not.toContain("<linearGradient");
  });
});
