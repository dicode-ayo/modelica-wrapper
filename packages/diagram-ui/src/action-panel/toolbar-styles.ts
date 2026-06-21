import { css } from "lit";

/**
 * Square icon-button base + glyph sizing, shared by the toolbar
 * (`<om-action-panel>`) and its `<om-split-button>`s so the two read as one
 * control strip. Pair with `omTokens` (which defines `--om-icon-size-*`).
 */
export const toolbarButtonStyles = css`
  wa-button::part(base) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* Square icon buttons — width follows the small-size height. */
    aspect-ratio: 1;
    min-inline-size: 0;
    padding-inline: 0;
  }

  .toolbar-icon {
    inline-size: var(--om-icon-size-md);
    block-size: var(--om-icon-size-md);
    display: block;
  }
`;
