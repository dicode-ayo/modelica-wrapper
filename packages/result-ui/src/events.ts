/**
 * DOM `CustomEvent`s the postprocessing components emit. Every event bubbles +
 * is composed so the bridge (`<om-result-view-root>` in the extension) can catch
 * them at the host boundary and translate to `postMessage`. `result-ui` itself
 * never touches the VSCode API — it's a pure renderer, exactly like `diagram-ui`.
 */

export interface AddPlotDetail {
  /** Insert after this card index; `-1` = at the top. */
  afterIndex: number;
}
export interface DeletePlotDetail {
  cardIndex: number;
}
export interface AddTraceDetail {
  cardIndex: number;
  resultId: string;
  variable: string;
}
export interface RemoveTraceDetail {
  cardIndex: number;
  traceIndex: number;
}
/** Emitted when the picker needs a result's variable list it doesn't have yet. */
export interface RequestVariablesDetail {
  resultId: string;
}
export interface AddResultDetail {
  via: "pick" | "cache";
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
  interface GlobalEventHandlersEventMap {
    "om-add-plot": CustomEvent<AddPlotDetail>;
    "om-delete-plot": CustomEvent<DeletePlotDetail>;
    "om-add-trace": CustomEvent<AddTraceDetail>;
    "om-remove-trace": CustomEvent<RemoveTraceDetail>;
    "om-request-variables": CustomEvent<RequestVariablesDetail>;
    "om-add-result": CustomEvent<AddResultDetail>;
    "om-remove-result": CustomEvent<RemoveResultDetail>;
    "om-rename-result": CustomEvent<RenameResultDetail>;
  }
}
