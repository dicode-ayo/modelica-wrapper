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
 *   - `radius-sm | md | lg` — small (controls) → large (modals)
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

    /* --- stacking layers --- */
    --om-z-overlay: 50;
    --om-z-modal: 200;

    /* --- form widgets --- */
    --om-input-padding: 4px 6px;
    --om-button-padding: 4px 12px;
    --om-form-label-width: 9em;
    --om-textarea-min-height: 60px;

    /* --- modal / overlay --- */
    --om-modal-min-width: 360px;
    --om-modal-max-width: 540px;
    --om-modal-max-vw: 90vw;
    --om-modal-max-height: 80vh;
    --om-modal-offset-top: 8vh;
    --om-modal-backdrop: rgba(0, 0, 0, 0.55);
    --om-modal-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);

    /* --- action panel --- */
    --om-action-panel-offset: 8px;

    /* --- typography --- */
    --om-title-size: 1.1em;
    --om-description-size: 0.92em;

    /* --- state --- */
    --om-disabled-opacity: 0.55;
  }
`;
