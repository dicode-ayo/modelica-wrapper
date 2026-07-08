/**
 * `<om-library-browser>` — modal overlay for browsing loaded Modelica
 * libraries and picking a class to instantiate.
 *
 * The modal shell is Web Awesome's `<wa-dialog>`; the tree, search, lazy
 * expansion, per-class icons, and selection all live in the embedded
 * `<om-library-tree>`. The browser stays data-source-driven: it knows
 * nothing about OMC. The embedder supplies a `LibraryBrowserDataSource`
 * (the same contract `<om-library-tree>` consumes) and the browser hands
 * it straight to the tree.
 *
 * Events:
 *   - `om-library-select` { detail: { className: string } } — forwarded
 *     from the embedded tree's activation. The host should call OMC
 *     `addComponent` (or whatever) in response. Selecting also closes the
 *     overlay.
 *   - `om-library-cancel` — Escape key, backdrop click, or the X button
 *     (forwarded from wa-dialog's `wa-hide`).
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, query } from "lit/decorators.js";

import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import type WaDialog from "@awesome.me/webawesome/dist/components/dialog/dialog.js";

import { omTokens } from "@dicode/ui-common";

import "../library-tree/library-tree.component.js";

/**
 * Modelica class restrictions surfaced in the palette. Mirrors OMC's
 * `getClassRestriction` output, plus an `"unknown"` fallback for
 * implementations that can't (or don't want to) resolve the kind.
 */
export type LibraryClassRestriction =
  | "package"
  | "model"
  | "block"
  | "class"
  | "connector"
  | "expandable connector"
  | "record"
  | "function"
  | "type"
  | "operator"
  | "operator function"
  | "operator record"
  | "unknown";

/**
 * One row in a `listChildren` / `searchAll` response. The tree uses the
 * restriction both to pick an icon and to decide whether the row should be
 * lazy-expandable — only `package` (and `unknown` as a safe default) is
 * treated as a container.
 */
export interface LibraryClassInfo {
  /** Fully qualified dotted name (e.g. `Modelica.Blocks.Math.Gain`). */
  qualified: string;
  /** Modelica class restriction; drives icon + expandability. */
  restriction: LibraryClassRestriction;
}

/** Class the user picked from the tree / search results. */
export interface LibrarySelectDetail {
  className: string;
}

/** `om-library-cancel` carries no detail; the type is here for symmetry. */
export type LibraryCancelDetail = undefined;

/**
 * Event-name → detail-type map for `<om-library-browser>`. Consumers
 * can write `(e: CustomEvent<LibraryEvents["om-library-select"]>) => …`
 * or import `LibrarySelectDetail` directly.
 */
export interface LibraryEvents {
  "om-library-select": LibrarySelectDetail;
  "om-library-cancel": LibraryCancelDetail;
}

/**
 * Pluggable data source. Errors thrown by any method surface in the tree
 * as an inline message; the overlay stays open so the user can retry.
 */
export interface LibraryBrowserDataSource {
  /**
   * List immediate child classes of `parent`. Pass `null` for the
   * loaded top-level classes (OMC's `AllLoadedClasses`).
   */
  listChildren(parent: string | null): Promise<LibraryClassInfo[]>;
  /**
   * Return qualified class names matching `query`. The tree debounces
   * user input before calling this, but the implementation is responsible
   * for any backend-side query optimisation.
   */
  searchAll(query: string): Promise<LibraryClassInfo[]>;
  /**
   * Render `className`'s icon to a self-contained SVG thumbnail, or
   * resolve `undefined` when the class has no usable icon. Optional: a
   * data source that omits it (or returns undefined) leaves rows showing
   * their restriction-letter badge. Requested lazily per row so the icon
   * fetch never runs for the whole tree (issue #76, item 8).
   */
  iconSvg?(className: string): Promise<string | undefined>;
}

@customElement("om-library-browser")
export class OmLibraryBrowser extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: contents;
      }

      /* Bound the embedded tree to a definite height so its virtualizer
       * scrolls internally instead of growing the dialog to full content. */
      om-library-tree {
        height: var(--om-library-body-min-height);
      }
    `,
  ];

  /** Whether the modal is shown. */
  @property({ type: Boolean, reflect: true })
  open = false;

  /** Title shown in the dialog header. */
  @property() override title = "Add component";

  /**
   * Data source. When `null` (default) the embedded tree renders a "no
   * data source configured" message — useful in stories where the
   * embedder has not wired anything up yet.
   */
  @property({ attribute: false })
  dataSource: LibraryBrowserDataSource | null = null;

  @query("wa-dialog") private dialogEl?: WaDialog;

  override render(): TemplateResult {
    // Only mount the wa-dialog while the modal is open. wa components are
    // form-associated and rely on ElementInternals APIs that aren't
    // available under happy-dom's test environment — keeping them out of
    // the DOM until the user actually opens the browser keeps both tests
    // and idle-page memory clean.
    if (!this.open) return html`${nothing}`;
    return html`
      <wa-dialog
        open
        label=${this.title}
        light-dismiss
        @wa-hide=${this.onDialogHide}
      >
        <om-library-tree
          .dataSource=${this.dataSource}
          @om-library-select=${this.onTreeSelect}
        ></om-library-tree>
      </wa-dialog>
    `;
  }

  /**
   * Maps wa-dialog's hide event back onto our `open` property +
   * `om-library-cancel` event. `wa-hide` is cancellable; we don't cancel.
   */
  private onDialogHide = (e: Event): void => {
    // Only react to closures from inside the dialog (backdrop click,
    // Escape, X). Programmatic close via setting our `open` prop will
    // also fire wa-hide on the wa-dialog, but that's fine — we'll just
    // toggle our own state to match what's already happening.
    e.stopPropagation();
    if (this.open) {
      this.open = false;
      this.dispatchEvent(
        new CustomEvent<LibraryEvents["om-library-cancel"]>(
          "om-library-cancel",
          { bubbles: true, composed: true },
        ),
      );
    }
  };

  // The embedded tree's select event bubbles + is composed, so it would
  // reach the host on its own. Intercept it here to close the dialog and
  // re-dispatch from the browser, keeping the browser the single emitter
  // consumers bind to.
  private onTreeSelect = (e: CustomEvent<LibrarySelectDetail>): void => {
    e.stopPropagation();
    this.open = false;
    // Close the host wa-dialog imperatively so the next open doesn't
    // re-trigger animations from a half-open state.
    if (this.dialogEl) {
      this.dialogEl.open = false;
    }
    this.dispatchEvent(
      new CustomEvent<LibraryEvents["om-library-select"]>("om-library-select", {
        detail: { className: e.detail.className },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "om-library-browser": OmLibraryBrowser;
  }
}
