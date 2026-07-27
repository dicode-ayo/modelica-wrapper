/**
 * Shared CSS custom property defaults for all `<om-*>` UI components.
 *
 * Pulled in as the first entry of each component's `static styles`
 * array so the defaults land on the component's own shadow root. CSS
 * custom properties inherit through shadow DOM boundaries by design,
 * so an embedder can override any of these on a light-DOM ancestor
 * (e.g. `body { --om-space-md: 10px }`) and every nested `<om-*>`
 * picks the override up.
 *
 * Colour tokens are intentionally absent here — components reference
 * VSCode's `--vscode-*` palette directly, with a hard-coded fallback
 * inside each `var(--vscode-..., #fallback)` for Storybook / off-VSCode
 * hosts. Sizing / spacing / radii belong to *us*, hence centralised.
 *
 * Naming:
 *   - `space-2xs … xl`   — paddings, gaps, margins
 *   - `radius-sm | md | lg | xl` — small (controls) → large (modals) → pill-ish
 *   - `z-overlay | modal`   — stacking layers
 *   - others (input-padding, modal-*) — semantic where a raw scale
 *     value would obscure intent.
 */

import { css, type CSSResult } from "lit";

export const omTokens: CSSResult = css`
  :host {
    /* --- spacing scale --- */
    --om-space-2xs: 2px;
    --om-space-xs: 4px;
    --om-space-sm: 6px;
    --om-space-md: 8px;
    --om-space-lg: 12px;
    --om-space-xl: 16px;

    /* --- radii --- */
    --om-radius-sm: 2px;
    --om-radius-md: 4px;
    --om-radius-lg: 6px;
    --om-radius-xl: 10px;

    /* --- stacking layers --- */
    --om-z-overlay: 50;
    --om-z-modal: 200;

    /* --- elevation --- */
    --om-shadow-overlay: 0 2px 8px rgba(0, 0, 0, 0.25);

    /* --- form widgets --- */
    --om-input-padding: 4px 6px;
    --om-button-padding: 4px 12px;
    --om-form-label-width: 9em;
    --om-textarea-min-height: 60px;
    --om-unit-select-width: 10em;

    /* --- modal / overlay --- */
    --om-modal-min-width: 360px;
    --om-modal-max-width: 540px;
    --om-modal-max-vw: 90vw;
    --om-modal-max-height: 80vh;
    --om-modal-offset-top: 8vh;
    --om-modal-backdrop: rgba(0, 0, 0, 0.55);
    --om-modal-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);

    /* --- floating panel (parameter / simulation) ---
     * Width has to clear the form's label column plus a control and its unit
     * dropdown. Height is left to whatever container places the panel. */
    --om-panel-float-width: 420px;

    /* --- result view (postprocessing) ---
     * Results rail width (and its collapse floor) plus the minimum height a
     * plot card's chart claims before ECharts sizes it. */
    --om-result-rail-size: 240px;
    --om-result-rail-min-size: 160px;
    --om-chart-min-height: 280px;

    /* --- action panel --- */
    --om-action-panel-offset: 8px;

    /* --- error state card --- */
    --om-error-card-max-width: 480px;
    --om-error-card-icon-size: 32px;

    /* --- drop target affordance ---
     * Outline width the diagram canvas paints while a draggable library class
     * hovers over it, signalling it accepts the drop. */
    --om-drop-outline-width: 2px;

    /* --- typography --- */
    --om-title-size: 1.1em;
    --om-title-weight: 600;
    --om-description-size: 0.92em;
    --om-qualifier-size: 0.85em;
    --om-badge-font-size: 10px;
    --om-badge-font-weight: 700;

    /* --- inline icons / badges ---
     * icon-sm is for cursor-style affordances (chevrons, indicators
     * inside text rows); icon-md is for full-sized badges and the
     * library restriction glyphs. */
    --om-icon-size-sm: 0.85em;
    --om-icon-size-md: 16px;

    /* --- library tree ---
     * Virtualized row height (fixed so the virtualizer can size the scroll
     * range without measuring), the per-level indentation step, and the
     * row font size (fallback for --vscode-font-size outside the webview). */
    --om-tree-row-height: 22px;
    --om-tree-indent: 14px;
    --om-tree-font-size: 13px;

    /* --- restriction badges ---
     * Fallback letter-badge palette (loose VSCode symbol-kind colours) shown
     * in front of a class until its rendered SVG icon arrives. Two glyph
     * colours cover every badge; the background varies per restriction. */
    --om-restriction-fg-on-dark: #fff;
    --om-restriction-fg-on-light: #1f1f1f;
    --om-restriction-package-bg: #3b82f6;
    --om-restriction-model-bg: #7c3aed;
    --om-restriction-block-bg: #10b981;
    --om-restriction-class-bg: #64748b;
    --om-restriction-connector-bg: #f59e0b;
    --om-restriction-record-bg: #fde68a;
    --om-restriction-function-bg: #ef4444;
    --om-restriction-type-bg: #bae6fd;
    --om-restriction-operator-bg: #0ea5e9;
    --om-restriction-unknown-bg: #9ca3af;

    /* --- state --- */
    --om-disabled-opacity: 0.55;
  }
`;
