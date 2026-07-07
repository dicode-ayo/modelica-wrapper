/**
 * Parse a CSS colour string into a `0xRRGGBB` integer for Pixi. Accepts the
 * two forms the renderer emits: a hex `#rrggbb` (or bare `rrggbb`) and the
 * `rgb(r,g,b)` string `colorToCss` (`@dicode/diagram-svg`) produces. Returns
 * `undefined` for anything else so callers can fall back to a default colour.
 */
export function parseCssColor(input: string | undefined): number | undefined {
  if (!input) {
    return undefined;
  }
  const hex = input.match(/^#?([0-9a-fA-F]{6})$/)?.[1];
  if (hex !== undefined) {
    return parseInt(hex, 16);
  }
  const rgb = input.match(
    /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/,
  );
  const r = rgb?.[1];
  const g = rgb?.[2];
  const b = rgb?.[3];
  if (r === undefined || g === undefined || b === undefined) {
    return undefined;
  }
  const rn = Number(r);
  const gn = Number(g);
  const bn = Number(b);
  if (rn > 255 || gn > 255 || bn > 255) {
    return undefined;
  }
  return (rn << 16) | (gn << 8) | bn;
}
