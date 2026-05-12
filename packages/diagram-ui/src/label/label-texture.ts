import { AdvancedDynamicTexture } from "@babylonjs/gui";
import type { Scene } from "@babylonjs/core";

/**
 * Lazy per-scene `AdvancedDynamicTexture` reused by every `<om-label>`.
 *
 * Creating one texture per scene rather than per label keeps the GUI
 * draw call count flat as we add hundreds of labels. The texture is
 * stashed under `scene.metadata.omLabelTexture` (we don't subclass
 * Scene; the metadata bag is the standard escape hatch).
 *
 * Returns `null` on `NullEngine` (headless test contexts). Babylon's
 * AdvancedDynamicTexture schedules a debounced refresh that would
 * otherwise fire on a disposed render context and surface as an
 * unhandled exception in vitest. Headless tests still get a real
 * anchor TransformNode and the `currentText` getter on the label —
 * they just skip the actual GUI render.
 *
 * Disposed when the scene disposes.
 */
const SCENE_META_KEY = "omLabelTexture";

interface SceneMeta {
  [SCENE_META_KEY]?: AdvancedDynamicTexture | undefined;
}

export function ensureLabelTexture(
  scene: Scene,
): AdvancedDynamicTexture | null {
  if (scene.getEngine().constructor.name === "NullEngine") {
    return null;
  }
  const metadata = (scene.metadata as SceneMeta | null | undefined) ?? {};
  const existing = metadata[SCENE_META_KEY];
  if (existing) {
    return existing;
  }
  const tex = AdvancedDynamicTexture.CreateFullscreenUI(
    "om-label-ui",
    true,
    scene,
  );
  metadata[SCENE_META_KEY] = tex;
  scene.metadata = metadata;
  scene.onDisposeObservable.add(() => {
    tex.dispose();
    metadata[SCENE_META_KEY] = undefined;
  });
  return tex;
}
