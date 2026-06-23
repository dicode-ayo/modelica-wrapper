/**
 * The diagram's active drawing tool. `select` is the default resting tool
 * (rubber-band + pick); the others arm a draw of that primitive. Sticky — a
 * tool stays armed until another is picked or it's disarmed.
 *
 * Draw tools split by gesture: extent tools (`rectangle` / `ellipse`) draw by
 * press-drag-release; poly tools (`line` / `polygon`) draw by multi-click,
 * placing one vertex per click.
 */
export type ExtentKind = "rectangle" | "ellipse";
export type PolyKind = "line" | "polygon";
export type DrawKind = ExtentKind | PolyKind;
export type ToolId = "select" | DrawKind;

export const EXTENT_KINDS: readonly ExtentKind[] = ["rectangle", "ellipse"];
export const POLY_KINDS: readonly PolyKind[] = ["line", "polygon"];

/** The extent shape a tool draws by press-drag, or `null` otherwise. Keyed on
 *  `EXTENT_KINDS` so a poly (or future) tool can't leak through as an
 *  `ExtentKind`. Takes a bare `string` so it also narrows a raw event value. */
export function extentKindOf(tool: string): ExtentKind | null {
  return EXTENT_KINDS.find((k) => k === tool) ?? null;
}

/** The poly shape a tool draws by multi-click, or `null` otherwise. */
export function polyKindOf(tool: string): PolyKind | null {
  return POLY_KINDS.find((k) => k === tool) ?? null;
}

/** Any draw shape a tool draws, extent or poly, or `null` for `select`. */
export function drawKindOf(tool: string): DrawKind | null {
  return extentKindOf(tool) ?? polyKindOf(tool);
}
