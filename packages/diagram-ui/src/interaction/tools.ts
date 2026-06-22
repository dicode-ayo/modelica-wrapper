/**
 * The diagram's active drawing tool. `select` is the default resting tool
 * (rubber-band + pick); the others arm a press-drag that draws that primitive.
 * Sticky — a tool stays armed until another is picked or it's disarmed.
 */
export type DrawKind = "rectangle" | "ellipse";
export type ToolId = "select" | DrawKind;

export const DRAW_KINDS: readonly DrawKind[] = ["rectangle", "ellipse"];

/** The shape kind a tool draws, or `null` for any non-drawing tool. Keyed on
 *  `DRAW_KINDS` so a future non-drawing tool can't leak through as a `DrawKind`. */
export function drawKindOf(tool: ToolId): DrawKind | null {
  return DRAW_KINDS.find((k) => k === tool) ?? null;
}
