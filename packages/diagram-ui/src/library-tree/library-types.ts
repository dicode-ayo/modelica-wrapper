/**
 * Shared contract for the library tree: the class-info payload, the pluggable
 * data source, and the event detail types. Kept apart from the component so
 * consumers can type against the contract without importing the element.
 */

/**
 * Modelica class restrictions surfaced in the tree. Mirrors OMC's
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
 * One row in a `listChildren` / `searchAll` response. The restriction drives
 * both the row icon and whether the row is lazy-expandable — only `package`
 * (and `unknown` as a safe default) is treated as a container.
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

/** Class the user right-clicked, for a per-node context-menu action. */
export interface LibraryContextMenuDetail {
  className: string;
  restriction: LibraryClassRestriction;
  /** Trailing name segment shown in the row (a file-name / display default). */
  displayName: string;
  /** Client coordinates to anchor the menu at. */
  x: number;
  y: number;
}

/**
 * Event-name → detail-type map. Consumers can write
 * `(e: CustomEvent<LibraryEvents["om-library-select"]>) => …` or import
 * `LibrarySelectDetail` directly.
 */
export interface LibraryEvents {
  "om-library-select": LibrarySelectDetail;
  "om-library-cancel": LibraryCancelDetail;
  "om-library-context-menu": LibraryContextMenuDetail;
}

/**
 * Pluggable data source. Errors thrown by either method surface in the UI as
 * an inline message; the tree stays mounted so the user can retry.
 */
export interface LibraryDataSource {
  /**
   * List immediate child classes of `parent`. Pass `null` for the
   * loaded top-level classes (OMC's `AllLoadedClasses`).
   */
  listChildren(parent: string | null): Promise<LibraryClassInfo[]>;
  /**
   * Return qualified class names matching `query`. The tree debounces user
   * input before calling this, but the implementation is responsible for any
   * backend-side query optimisation.
   *
   * `signal` aborts when the query is superseded or cleared. Resolving a
   * search costs one backend round-trip per hit, so an implementation that can
   * abandon that work should honour the signal and reject with `signal.reason`.
   */
  searchAll(query: string, signal?: AbortSignal): Promise<LibraryClassInfo[]>;
  /**
   * Render `className`'s icon to a self-contained SVG thumbnail, or resolve
   * `undefined` when the class has no usable icon. Optional: a data source
   * that omits it (or returns undefined) leaves rows showing their
   * restriction-letter badge. Requested lazily per row so the icon fetch never
   * runs for the whole tree.
   */
  iconSvg?(className: string): Promise<string | undefined>;
}
