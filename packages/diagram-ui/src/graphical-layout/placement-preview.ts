/**
 * Builds the transient layout that renders a placement preview: the dragged
 * class shown as the component it will become, tracking the cursor, before it
 * is committed. The class definition and a synthetic instance are merged into a
 * copy of the base layout so the normal component renderer draws the real icon
 * and ports — no bespoke ghost geometry.
 */

import type { ClassDef, DiagramLayout, Placement } from "@dicode/omc-client";

/** Instance id of the preview component. The `$` prefix keeps it clear of
 *  ordinary Modelica identifiers so it won't shadow a real component. */
export const PLACEMENT_PREVIEW_ID = "$placement-preview";

/** Half the side of the placement extent, in diagram units. Matches the extent
 *  the host writes on commit, so the preview is the size of the result. */
export const PLACEMENT_HALF_EXTENT = 10;

/**
 * Merge a preview of `classDef` at `point` (diagram coords) into `base`. The
 * preview instance carries the same square placement the host assigns on drop,
 * so what the cursor shows is what lands. An icon only takes connectors, so
 * there the preview is a standalone connector, drawn as the drop will be.
 * Returns a new layout; `base` is not mutated.
 */
export function buildPlacementPreview(
  base: DiagramLayout,
  classDef: ClassDef,
  point: { x: number; y: number },
): DiagramLayout {
  const h = PLACEMENT_HALF_EXTENT;
  const placement: Placement = {
    extent: [
      [point.x - h, point.y - h],
      [point.x + h, point.y + h],
    ],
  };
  const preview = {
    name: PLACEMENT_PREVIEW_ID,
    classRef: classDef.name,
    placement,
  };
  const classes = { ...base.classes, [classDef.name]: classDef };
  return base.kind === "icon"
    ? {
        ...base,
        classes,
        connectors: { ...base.connectors, [PLACEMENT_PREVIEW_ID]: preview },
      }
    : {
        ...base,
        classes,
        components: { ...base.components, [PLACEMENT_PREVIEW_ID]: preview },
      };
}
