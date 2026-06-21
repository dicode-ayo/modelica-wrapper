import { html, type TemplateResult } from "lit";

import type { DrawKind } from "../interaction/tools.js";

/**
 * Inline-SVG toolbar glyphs. The webview CSP (`default-src none`) blocks
 * `wa-icon library=system`, which fetches its glyphs — so toolbar buttons slot
 * raw `<svg fill="currentColor">`, matching the library-browser chevron. Each
 * inherits the button's text color and is sized by `.toolbar-icon` in the host.
 */

function glyph(body: TemplateResult): TemplateResult {
  return html`<svg
    class="toolbar-icon"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${body}
  </svg>`;
}

export const undoIcon = glyph(
  html`<path d="M5 4 2 7l3 3" /> <path d="M2 7h7a4 4 0 0 1 0 8H6" />`,
);

export const checkIcon = glyph(
  html`<path d="M3 8.5 6.5 12 13 4" stroke-width="2" />`,
);

export const simulateIcon = glyph(
  html`<path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />`,
);

export const parametersIcon = glyph(
  html`<path d="M2 5h12M2 11h12" />
    <circle cx="6" cy="5" r="2" fill="currentColor" stroke="none" />
    <circle cx="10" cy="11" r="2" fill="currentColor" stroke="none" />`,
);

export const rotateIcon = glyph(
  html`<path d="M13 8a5 5 0 1 1-1.8-3.85" /> <path d="M13 2.5V5h-2.5" />`,
);

export const flipIcon = glyph(
  html`<path d="M8 2v12" />
    <path d="M5.5 5 2.5 8l3 3z" fill="currentColor" />
    <path d="M10.5 5l3 3-3 3z" fill="currentColor" />`,
);

export const rectangleIcon = glyph(
  html`<rect x="2.5" y="4" width="11" height="8" rx="0.5" />`,
);

export const ellipseIcon = glyph(html`<ellipse cx="8" cy="8" rx="6" ry="4" />`);

// `wa-button with-caret` renders a `wa-icon` (fetch-loaded, CSP-blocked here),
// so the dropdown trigger slots this caret instead.
export const caretIcon = glyph(html`<path d="M4 6l4 4 4-4" />`);

/** The glyph for a drawing tool's shape. */
export function drawKindIcon(kind: DrawKind): TemplateResult {
  return kind === "rectangle" ? rectangleIcon : ellipseIcon;
}
