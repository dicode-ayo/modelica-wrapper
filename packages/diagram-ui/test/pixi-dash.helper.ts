import type { Graphics } from "pixi.js";

/** Count of drawn dash runs in a stroked Graphics. Pixi batches every
 *  `moveTo`/`lineTo` into the single `stroke` instruction's path, so the
 *  dash count is the `lineTo` count within that path's own instructions —
 *  each run is one `moveTo` + `lineTo` pair. */
export function dashCount(g: Graphics): number {
  type PathInstruction = { action: string };
  type StrokeInstruction = {
    action: string;
    data: { path?: { instructions: PathInstruction[] } };
  };
  return (g.context.instructions as ReadonlyArray<StrokeInstruction>)
    .flatMap((i) => i.data.path?.instructions ?? [])
    .filter((i) => i.action === "lineTo").length;
}
