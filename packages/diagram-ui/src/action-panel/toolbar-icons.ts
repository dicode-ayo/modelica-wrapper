import { html, svg, type SVGTemplateResult, type TemplateResult } from "lit";

import type { DrawKind } from "../interaction/tools.js";

/**
 * Toolbar glyphs, inlined as SVG. The webview CSP (`default-src none`) blocks
 * `wa-icon library=system`, which fetches its glyphs, and Web Awesome ships no
 * local SVGs to bundle — so the toolbar slots raw `<svg fill="currentColor">`.
 * The geometry is Lucide (MIT): one 24×24 stroke grid keeps every glyph the
 * same visual weight and centered, which a mix of hand-drawn paths did not.
 *
 * Shape bodies use Lit's `svg` tag, not `html`: a `<path>` built in a
 * standalone `html` template lands in the HTML namespace and renders nothing
 * once slotted into the `<svg>`.
 */

export function glyph(
  body: SVGTemplateResult,
  klass = "toolbar-icon",
): TemplateResult {
  return html`<svg
    class=${klass}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${body}
  </svg>`;
}

export const checkIcon = glyph(svg`<path d="M20 6 9 17l-5-5" />`);

export const simulateIcon = glyph(
  svg`<path d="M6 3 20 12 6 21Z" fill="currentColor" stroke="none" />`,
);

export const parametersIcon = glyph(
  svg`<path d="M10 5h11" /><path d="M3 5h3" /><circle cx="8" cy="5" r="2" />
    <path d="M16 12h5" /><path d="M3 12h9" /><circle cx="14" cy="12" r="2" />
    <path d="M10 19h11" /><path d="M3 19h3" /><circle cx="8" cy="19" r="2" />`,
);

export const rotateIcon = glyph(
  svg`<path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" />`,
);

export const rotateCcwIcon = glyph(
  svg`<path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />`,
);

export const flipIcon = glyph(
  svg`<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" />
    <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
    <path d="M12 2v2" /><path d="M12 8v2" /><path d="M12 14v2" />
    <path d="M12 20v2" />`,
);

export const flipVerticalIcon = glyph(
  svg`<path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3" />
    <path d="M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3" />
    <path d="M2 12h2" /><path d="M8 12h2" /><path d="M14 12h2" />
    <path d="M20 12h2" />`,
);

export const rectangleIcon = glyph(
  svg`<rect x="3" y="5" width="18" height="14" rx="1.5" />`,
);

export const ellipseIcon = glyph(
  svg`<ellipse cx="12" cy="12" rx="9" ry="6" />`,
);

export const chevronDownIcon = glyph(svg`<path d="m6 9 6 6 6-6" />`);

export const lineIcon = glyph(
  svg`<path d="m3 17 6-7 4 4 8-9" />
    <circle cx="3" cy="17" r="1.4" /><circle cx="21" cy="5" r="1.4" />`,
);

export const polygonIcon = glyph(
  svg`<path d="M12 3 21 9.5 17.5 20h-11L3 9.5z" />`,
);

/** The glyph for a drawing tool's shape, extent or poly. */
export function drawToolIcon(kind: DrawKind): TemplateResult {
  switch (kind) {
    case "rectangle":
      return rectangleIcon;
    case "ellipse":
      return ellipseIcon;
    case "line":
      return lineIcon;
    case "polygon":
      return polygonIcon;
  }
}
