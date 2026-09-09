import type { Graphics } from "pixi.js";

type PathInstruction = { action: string; data: unknown };

/** Every path instruction Pixi batched into `g`'s draw instructions. */
export function pathInstructions(g: Graphics): PathInstruction[] {
  type ContextInstruction = {
    data: { path?: { instructions: PathInstruction[] } };
  };
  return (g.context.instructions as ReadonlyArray<ContextInstruction>).flatMap(
    (i) => i.data.path?.instructions ?? [],
  );
}

/** Count of drawn dash runs in a stroked Graphics. Pixi batches every
 *  `moveTo`/`lineTo` into the single `stroke` instruction's path, so the
 *  dash count is the `lineTo` count within that path's own instructions —
 *  each run is one `moveTo` + `lineTo` pair. */
export function dashCount(g: Graphics): number {
  return pathInstructions(g).filter((i) => i.action === "lineTo").length;
}

/** The `moveTo`/`lineTo` vertices Pixi batched into `g`'s path. */
export function pathVertices(g: Graphics): Array<[number, number]> {
  return pathInstructions(g)
    .filter((i) => i.action === "moveTo" || i.action === "lineTo")
    .map((i) => {
      const [x, y] = i.data as [number, number];
      return [x, y] as [number, number];
    });
}
