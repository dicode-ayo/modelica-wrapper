/**
 * DOM `CustomEvent`s the postprocessing components emit. Every event bubbles +
 * is composed so the bridge (`<om-result-view-root>` in the extension) can catch
 * them at the host boundary and translate to `postMessage`. `result-ui` itself
 * never touches the VSCode API — it's a pure renderer, exactly like `diagram-ui`.
 */

export interface AddPlotDetail {
  /** Insert after this card position; `-1` = at the top. Insertion is the one
   * positional op — every other card op addresses a card by `cardId`. */
  afterIndex: number;
}
export interface DeletePlotDetail {
  cardId: string;
}
export interface AddTraceDetail {
  cardId: string;
  resultId: string;
  variable: string;
}
export interface RemoveTraceDetail {
  cardId: string;
  traceIndex: number;
}
/** Emitted when the picker needs a result's variable list it doesn't have yet. */
export interface RequestVariablesDetail {
  resultId: string;
}
export interface AddResultDetail {
  /** Matches `ResultSource`: a file `import` (via the file dialog) or the
   * workspace `.modelica` `cache`. */
  via: "import" | "cache";
}
export interface RemoveResultDetail {
  resultId: string;
}
export interface RenameResultDetail {
  resultId: string;
  label: string;
}

/** Event-name → detail-type map for the postprocessing components. */
export interface ResultViewEvents {
  "om-add-plot": AddPlotDetail;
  "om-delete-plot": DeletePlotDetail;
  "om-add-trace": AddTraceDetail;
  "om-remove-trace": RemoveTraceDetail;
  "om-request-variables": RequestVariablesDetail;
  "om-add-result": AddResultDetail;
  "om-remove-result": RemoveResultDetail;
  "om-rename-result": RenameResultDetail;
}

export type ResultViewEventName = keyof ResultViewEvents;

/** `ResultViewEvents` lifted into the `CustomEvent` map shape — derived so the
 * global augmentation below can't drift from the source-of-truth interface. */
type ResultViewEventMap = {
  [K in ResultViewEventName]: CustomEvent<ResultViewEvents[K]>;
};

/** Dispatch a bubbling, composed `CustomEvent` from `el`. */
export function fireEvent<K extends ResultViewEventName>(
  el: HTMLElement,
  type: K,
  detail: ResultViewEvents[K],
): void {
  el.dispatchEvent(
    new CustomEvent<ResultViewEvents[K]>(type, {
      detail,
      bubbles: true,
      composed: true,
    }),
  );
}

declare global {
  interface GlobalEventHandlersEventMap extends ResultViewEventMap {}
}
