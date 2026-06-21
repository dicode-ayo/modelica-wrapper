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

function glyph(body: SVGTemplateResult): TemplateResult {
  return html`<svg
    class="toolbar-icon"
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

export const undoIcon = glyph(
  svg`<path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H10" />`,
);

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
  svg`<path d="M12 3v18" /><path d="M16 7v0" />
    <path d="M3 16 9 16 3 21Z" fill="currentColor" stroke="none" />
    <path d="M21 16 15 16 21 21Z" fill="currentColor" stroke="none" />`,
);

export const flipVerticalIcon = glyph(
  svg`<path d="M3 12h18" />
    <path d="M8 3 8 9 3 3Z" fill="currentColor" stroke="none" />
    <path d="M8 21 8 15 3 21Z" fill="currentColor" stroke="none" />`,
);

export const rectangleIcon = glyph(
  svg`<rect x="3" y="5" width="18" height="14" rx="1.5" />`,
);

export const ellipseIcon = glyph(
  svg`<ellipse cx="12" cy="12" rx="9" ry="6" />`,
);

export const chevronDownIcon = glyph(svg`<path d="m6 9 6 6 6-6" />`);

/** The glyph for a drawing tool's shape. */
export function drawKindIcon(kind: DrawKind): TemplateResult {
  return kind === "rectangle" ? rectangleIcon : ellipseIcon;
}
