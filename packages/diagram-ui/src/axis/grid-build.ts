import { Container, Graphics } from "pixi.js";

/**
 * Pure constructor for the grid, axes, and optional extent rectangle.
 * Separated from the `<om-grid-axis>` element so the same routine
 * drives tests, stories and the runtime element.
 *
 * Grid lines are decorative and pixel-thin, so each layer is a single
 * `Graphics` stroked with `pixelLine` (a crisp 1-px line independent of
 * the diagram zoom). One `Graphics` per layer (minor / major / axes)
 * keeps each colour separate.
 *
 * The extent rectangle is OMEdit's "drawing area": a filled rectangle
 * the size of the host class's `coordinateSystem.extent`, painted white
 * so the modeller sees where the canonical icon box lives against the
 * grey scene background. It is opt-in via `options.extentRect`.
 *
 * Paint order (no depth buffer — later children draw on top): the grid
 * root is given a negative `zIndex` by the element so it sits behind the
 * entity layer; within the root the extent fill draws first, then its
 * border, then the grid lines.
 */
export interface GridOptions {
  /** Half-extent of the grid lines, in diagram units. */
  extent: number;
  /** Spacing between minor lines on the X axis. */
  minorStep: number;
  /** Spacing between minor lines on the Y axis (defaults to `minorStep`). */
  minorStepY?: number | undefined;
  /** Spacing between major lines on the X axis. */
  majorStep: number;
  /** Spacing between major lines on the Y axis (defaults to `majorStep`). */
  majorStepY?: number | undefined;
  /** Minor-line colour as 0xRRGGBB. */
  minorColor?: number | undefined;
  /** Major-line colour as 0xRRGGBB. */
  majorColor?: number | undefined;
  /** Axis-line colour as 0xRRGGBB. */
  axisColor?: number | undefined;
  /**
   * Optional filled rectangle representing the host class's coordinate
   * system extent — OMEdit's white "drawing area". Coords are in
   * diagram units. Rendered behind the grid lines.
   */
  extentRect?:
    | {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        /** Fill colour 0xRRGGBB. Defaults to white. */
        color?: number | undefined;
        /**
         * Border stroke colour 0xRRGGBB. Defaults to a medium slate; set
         * to `null` to suppress the border (leaving only the fill).
         */
        borderColor?: number | null | undefined;
      }
    | undefined;
}

const DEFAULT_MINOR_COLOR = 0xebebf0;
const DEFAULT_MAJOR_COLOR = 0xc7c7d1;
const DEFAULT_AXIS_COLOR = 0x8c8c9e;
const DEFAULT_EXTENT_RECT_COLOR = 0xffffff;
const DEFAULT_EXTENT_BORDER_COLOR = 0x73738c;

export const DEFAULT_GRID_OPTIONS: GridOptions = {
  extent: 1000,
  // OMEdit's `grid = (2, 2)` is a SNAP step, not a draw step — the
  // visible grid is far coarser than the snap unit. Metadata grid →
  // rendered minor step is `metadata × 10` (so the common default of 2
  // produces a 20-unit minor grid). Major lines fall every 5 minors.
  minorStep: 20,
  majorStep: 100,
  minorColor: DEFAULT_MINOR_COLOR,
  majorColor: DEFAULT_MAJOR_COLOR,
  axisColor: DEFAULT_AXIS_COLOR,
};

export interface GridGraphics {
  root: Container;
  minor: Graphics;
  major: Graphics;
  axes: Graphics;
  /** Present only when `options.extentRect` is set. */
  extentRect?: Graphics;
  /** Border outline. Present only when the extent rect is built AND `borderColor !== null`. */
  extentBorder?: Graphics;
}

/** Builds the grid + axes (+ optional extent rect) and returns the handles. */
export function buildGrid(
  parent: Container,
  options: GridOptions = DEFAULT_GRID_OPTIONS,
): GridGraphics {
  const { extent } = options;
  const minorX = options.minorStep;
  const minorY = options.minorStepY ?? options.minorStep;
  const majorX = options.majorStep;
  const majorY = options.majorStepY ?? options.majorStep;

  const minor = new Graphics({ label: "om-grid-minor" });
  const major = new Graphics({ label: "om-grid-major" });

  // Vertical lines (constant x), stepped by X grid spacing.
  for (let v = -extent; v <= extent; v += minorX) {
    if (Math.abs(v) < 1e-9) {
      continue; // axes drawn separately
    }
    const g = Math.abs(v) % majorX < 1e-9 ? major : minor;
    g.moveTo(v, -extent).lineTo(v, extent);
  }
  // Horizontal lines (constant y), stepped by Y grid spacing.
  for (let v = -extent; v <= extent; v += minorY) {
    if (Math.abs(v) < 1e-9) {
      continue;
    }
    const g = Math.abs(v) % majorY < 1e-9 ? major : minor;
    g.moveTo(-extent, v).lineTo(extent, v);
  }
  minor.stroke({
    width: 1,
    color: options.minorColor ?? DEFAULT_MINOR_COLOR,
    pixelLine: true,
  });
  major.stroke({
    width: 1,
    color: options.majorColor ?? DEFAULT_MAJOR_COLOR,
    pixelLine: true,
  });

  const axes = new Graphics({ label: "om-grid-axes" });
  axes
    .moveTo(-extent, 0)
    .lineTo(extent, 0)
    .moveTo(0, -extent)
    .lineTo(0, extent)
    .stroke({
      width: 1,
      color: options.axisColor ?? DEFAULT_AXIS_COLOR,
      pixelLine: true,
    });

  // Decorative — the grid never eats picks meant for entities.
  for (const g of [minor, major, axes]) {
    g.eventMode = "none";
  }

  const root = parent;
  const result: GridGraphics = { root, minor, major, axes };

  if (options.extentRect) {
    const built = buildExtentRect(options.extentRect);
    result.extentRect = built.fill;
    root.addChild(built.fill);
    if (built.border) {
      result.extentBorder = built.border;
      root.addChild(built.border);
    }
  }

  root.addChild(minor, major, axes);
  return result;
}

function buildExtentRect(
  rect: NonNullable<GridOptions["extentRect"]>,
): { fill: Graphics; border?: Graphics } {
  const minX = Math.min(rect.x1, rect.x2);
  const maxX = Math.max(rect.x1, rect.x2);
  const minY = Math.min(rect.y1, rect.y2);
  const maxY = Math.max(rect.y1, rect.y2);
  const width = Math.max(1e-6, maxX - minX);
  const height = Math.max(1e-6, maxY - minY);

  const fill = new Graphics({ label: "om-grid-extent-rect" });
  fill.eventMode = "none";
  fill
    .rect(minX, minY, width, height)
    .fill(rect.color ?? DEFAULT_EXTENT_RECT_COLOR);

  if (rect.borderColor === null) {
    return { fill };
  }
  const border = new Graphics({ label: "om-grid-extent-border" });
  border.eventMode = "none";
  border
    .rect(minX, minY, width, height)
    .stroke({
      width: 1,
      color: rect.borderColor ?? DEFAULT_EXTENT_BORDER_COLOR,
      pixelLine: true,
    });
  return { fill, border };
}
