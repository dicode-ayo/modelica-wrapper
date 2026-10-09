/**
 * Builds the transient layout that renders a placement preview: the dragged
 * class shown as the component it will become, tracking the cursor, before it
 * is committed. The class definition and a synthetic instance are merged into a
 * copy of the base layout so the normal component renderer draws the real icon
 * and ports — no bespoke ghost geometry.
 */

import type {
  ClassDef,
  ComponentInstance,
  DiagramLayout,
} from "@dicode/omc-client";

/** Instance id of the preview component, and the prefix of its class's
 *  catalog key. The `$` keeps both clear of Modelica identifiers, so the
 *  preview shadows neither a real component nor a catalog entry. */
export const PLACEMENT_PREVIEW_ID = "$placement-preview";

/** Half the side of the placement extent, in diagram units. Matches the extent
 *  the host writes on commit, so the preview is the size of the result. */
export const PLACEMENT_HALF_EXTENT = 10;

/**
 * Merge a preview of `classDef` at `point` (diagram coords) into `base`. The
 * preview instance carries the same square placement the host assigns on drop,
 * so what the cursor shows is what lands. Returns a new layout; `base` is not
 * mutated.
 */
export function buildPlacementPreview(
  base: DiagramLayout,
  classDef: ClassDef,
  point: { x: number; y: number },
): DiagramLayout {
  const h = PLACEMENT_HALF_EXTENT;
  // The diagram's entry under the bare class name can be a use-site variant
  // of this class. The name stays in the key because a component's render key
  // includes its classRef, so a preview of another class remounts.
  const classKey = `${PLACEMENT_PREVIEW_ID}:${classDef.name}`;
  const preview: ComponentInstance = {
    name: PLACEMENT_PREVIEW_ID,
    classRef: classKey,
    placement: {
      extent: [
        [point.x - h, point.y - h],
        [point.x + h, point.y + h],
      ],
    },
  };
  return {
    ...base,
    classes: { ...base.classes, [classKey]: classDef },
    components: { ...base.components, [PLACEMENT_PREVIEW_ID]: preview },
  };
}
