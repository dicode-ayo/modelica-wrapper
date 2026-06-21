/**
 * The diagram's active drawing tool. `select` is the default resting tool
 * (rubber-band + pick); the others arm a press-drag that draws that primitive.
 * Sticky — a tool stays armed until another is picked or it's disarmed.
 */
export type DrawKind = "rectangle" | "ellipse";
export type ToolId = "select" | DrawKind;

export const DRAW_KINDS: readonly DrawKind[] = ["rectangle", "ellipse"];

/** The shape kind a tool draws, or `null` for the non-drawing `select` tool. */
export function drawKindOf(tool: ToolId): DrawKind | null {
  return tool === "select" ? null : tool;
}
