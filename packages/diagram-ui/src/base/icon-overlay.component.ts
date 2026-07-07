import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * `<om-icon-overlay>` — a single HTML element that paints the icon SVG
 * on top of the renderer canvas in screen-space. Lives inside the
 * shadow DOM of `<om-component>` / `<om-connector>` (one per entity).
 *
 * Layout strategy:
 *   - The host's positioning, size, and rotation are driven entirely by
 *     CSS custom properties on the host element itself (`--om-icon-x`,
 *     `--om-icon-y`, `--om-icon-w`, `--om-icon-h`, `--om-icon-rot`,
 *     `--om-icon-display`).
 *   - The static stylesheet hard-codes the `position: absolute`,
 *     `transform-origin`, the `transform` chain, etc. — only the
 *     custom-property *values* change at 60 Hz.
 *   - Writing custom properties via `style.setProperty(...)` is
 *     ~free compared to going through Lit's reactive property pipeline
 *     for every frame.
 *
 * Picking is always disabled on the overlay (`pointer-events: none`)
 * so the canvas underneath still receives every click/drag.
 */
@customElement("om-icon-overlay")
export class OmIconOverlay extends LitElement {
  static override styles = css`
    :host {
      position: absolute;
      top: 0;
      left: 0;
      display: var(--om-icon-display, none);
      width: var(--om-icon-w, 0px);
      height: var(--om-icon-h, 0px);
      transform-origin: center center;
      /*
       * Two translates: the first parks the icon centre at the target
       * pixel (sx, sy), the second subtracts half the element box so
       * the centre lines up with that point. Rotation goes last so it
       * pivots around the same centre.
       */
      transform: translate(var(--om-icon-x, 0px), var(--om-icon-y, 0px))
        translate(-50%, -50%) rotate(var(--om-icon-rot, 0deg));
      pointer-events: none;
      will-change: transform, width, height;
    }

    img {
      display: block;
      width: 100%;
      height: 100%;
      pointer-events: none;
      /* SVG inside <img> stays vector, so CSS scaling is crisp. */
      image-rendering: auto;
    }
  `;

  /**
   * Data URL (or absolute URL) of the icon SVG. Updates rebuild the
   * `<img>` element — keep stable references between renders to skip
   * decoder work.
   */
  @property({ type: String })
  src = "";

  /**
   * Set the projected bounding box + rotation in one call. Marks the
   * overlay visible. Cheap; intended to be called per frame from the
   * view-state reprojection.
   */
  setLayout(
    centerX: number,
    centerY: number,
    widthPx: number,
    heightPx: number,
    rotationDeg: number,
  ): void {
    const style = this.style;
    style.setProperty("--om-icon-display", "block");
    style.setProperty("--om-icon-x", `${centerX}px`);
    style.setProperty("--om-icon-y", `${centerY}px`);
    style.setProperty("--om-icon-w", `${widthPx}px`);
    style.setProperty("--om-icon-h", `${heightPx}px`);
    style.setProperty("--om-icon-rot", `${rotationDeg}deg`);
  }

  /** Hide the overlay (e.g. when the camera flips to perspective). */
  hide(): void {
    this.style.setProperty("--om-icon-display", "none");
  }

  override render() {
    if (!this.src) {
      return html``;
    }
    return html`<img src=${this.src} alt="" aria-hidden="true" />`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-icon-overlay": OmIconOverlay;
  }
}
